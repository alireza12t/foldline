"""Batched Qwen3-TTS CustomVoice generation on MLX, with the end-cut fix. Used by core/tts/tts_qwen.py.

generate_batch(model, texts, voice, instruct, lang) -> list of float32 numpy arrays (24 kHz), in input order.

What it does differently from mlx-audio's own batch generation (same model, same sampling settings):
 - one static batch with one shared KV cache
 - all sampling on the GPU: the repetition penalty over the last 64 first-codebook tokens of each row is kept
   as an array, and the suppress mask is built once
 - the 15-step code helper is one mx.compile'd function
 - step t+1 is queued (mx.async_eval) before step t's end flags are read, so Python overlaps the GPU
 - the caller sorts lines by length, so rows in a batch finish close together
 - the speech decoder runs in chunks of 25 frames, so memory stays flat whatever the line length

The end-cut fix (eos_hold): Qwen3-TTS often picks its end token on a frame where the last sound is still loud,
so the take stops mid-sound. With eos_hold=1, a row that picks the end token for the first time must make one
more frame first (end token masked). The model fills that frame with silence, so the last sound ends cleanly.
Measured on 42 takes: 12 cut without it, 0 with it.

lean(model) lowers memory: 8-bit text and code embeddings, bf16 speech decoder, no speech encoder (the encoder
is only needed for voice cloning). Peak about 4.5 GB at batch 16 instead of 7.3 GB.

Built against mlx-audio 0.6.4 (it uses the model's internals); requirements-qwen.txt pins that version.
"""
import gc
from functools import partial
import numpy as np
import mlx.core as mx
import mlx.nn as nn
from mlx.utils import tree_flatten
from mlx_audio.lm.sample_utils import apply_top_k, categorical_sampling


def _nbytes(mod):
    return sum(v.nbytes for _, v in tree_flatten(mod.parameters()))


def lean(model, emb_bits=8):
    """Lower the memory of a loaded CustomVoice model in place. Returns (GB before, GB after)."""
    before = (_nbytes(model.talker) + _nbytes(model.speech_tokenizer)) / 1e9
    nn.quantize(model.talker, group_size=64, bits=emb_bits,
                class_predicate=lambda p, m: isinstance(m, nn.Embedding) and ('text_embedding' in p or 'code_predictor.model.codec_embedding' in p))
    st = model.speech_tokenizer
    if getattr(st, 'encoder_model', None) is not None: st.encoder_model = None
    st.decoder.set_dtype(mx.bfloat16)
    mx.eval(model.parameters()); gc.collect(); mx.clear_cache()
    return round(before, 2), round((_nbytes(model.talker) + _nbytes(model.speech_tokenizer)) / 1e9, 2)


def _helper(model, temperature, top_k):
    tk = model.talker; cp = tk.code_predictor; emb0 = tk.get_input_embeddings()
    n = model.config.talker_config.num_code_groups - 1

    def sample(lg):
        lg = lg[:, -1, :]
        if temperature <= 0: return mx.argmax(lg, axis=-1, keepdims=True)
        lg = lg / temperature
        if 0 < top_k < lg.shape[-1]: lg = apply_top_k(lg, top_k)
        return categorical_sampling(lg, 1.0)[:, None]

    state = [mx.random.state]

    @partial(mx.compile, inputs=state, outputs=state)
    def fused(hidden_last, first):
        e0 = emb0(first); cache = cp.make_cache(); emb = e0; toks = [first]
        inp = mx.concatenate([hidden_last, e0], axis=1)
        for i in range(n):
            lg, cache, _ = cp(inp, cache=cache, generation_step=i)
            t = sample(lg); ce = cp.codec_embedding[i](t); emb = emb + ce; toks.append(t); inp = ce
        return mx.concatenate(toks, axis=1), emb
    return fused


def generate_batch(model, texts, voice='ryan', instruct=None, lang='english', temperature=0.9, top_k=50,
                   repetition_penalty=1.05, window=64, max_tokens=2048, chunk=25, eos_hold=1):
    """voice and instruct: one value for every row, or a list with one per row.
    eos_hold = K: a row that first picks the end token must make K more frames before it stops. 0 = the model's own ending."""
    cfg = model.config.talker_config; B = len(texts)
    eos = cfg.codec_eos_token_id; V = cfg.vocab_size
    vs = voice if isinstance(voice, list) else [voice] * B
    ins = instruct if isinstance(instruct, list) else [instruct] * B
    bi = model._prepare_batch_inputs(texts, language=lang, speakers=vs, instructs=ins, return_metadata=True)
    emb, trail, pad, mask = bi.input_embeds, bi.trailing_text_hidden, bi.tts_pad_embed, bi.attention_mask
    tl = mx.array(bi.trailing_lens, dtype=mx.int32)[:, None]                          # [B,1]
    sup = np.zeros((V,), np.float32); sup[V - 1024:] = -np.inf; sup[eos] = 0.0           # only codec tokens and the end token
    sup = mx.array(sup).astype(mx.float32)
    hist = mx.full((B, window), -1, dtype=mx.int32)
    key = (float(temperature), int(top_k))
    if getattr(model, '_fl_key', None) != key:
        model._fl_helper = _helper(model, temperature, top_k); model._fl_key = key
    fused = model._fl_helper
    cache = model.talker.make_cache()
    finished = mx.zeros((B,), dtype=mx.bool_); done_at = mx.full((B,), -1, dtype=mx.int32)
    is_eos = mx.arange(V) == eos; hold_until = mx.full((B,), -1, dtype=mx.int32)
    codes = []; inp = emb; prev_finished = None

    def pick(l):
        if temperature > 0:
            l = l / temperature
            if 0 < top_k < V: l = apply_top_k(l, top_k)
            return categorical_sampling(l, 1.0)[:, None]
        return mx.argmax(l, axis=-1, keepdims=True)

    for t in range(max_tokens):
        logits, hidden = model.talker(inp, cache=cache, attention_mask=mask)
        lg = logits[:, -1, :].astype(mx.float32) + sup
        if repetition_penalty != 1.0:
            safe = mx.maximum(hist, 0); sel = mx.take_along_axis(lg, safe, axis=-1)
            pen = mx.where(sel < 0, sel * repetition_penalty, sel / repetition_penalty)
            pen = mx.where(hist >= 0, pen, sel)
            lg = mx.put_along_axis(lg, safe, pen, axis=-1)
        first = pick(lg)
        if eos_hold > 0:                                   # first end attempt: K more frames with the end token masked
            alt = pick(mx.where(is_eos[None, :], -mx.inf, lg))
            want = (first[:, 0] == eos) & (~finished)
            hold_until = mx.where(want & (hold_until < 0), t + eos_hold, hold_until)
            in_hold = (hold_until >= 0) & (t < hold_until)
            end_now = (hold_until >= 0) & (t >= hold_until)
            first = mx.where(in_hold[:, None], alt, first)
            first = mx.where(end_now[:, None], mx.array(eos, dtype=first.dtype), first)
        first = mx.where(finished[:, None], mx.array(eos, dtype=first.dtype), first).astype(mx.int32)
        new_fin = first[:, 0] == eos
        done_at = mx.where((~finished) & new_fin, t, done_at)
        finished = finished | new_fin
        allc, cemb = fused(hidden[:, -1:, :], first)
        idx = mx.minimum(mx.array(t, dtype=mx.int32), mx.maximum(tl - 1, 0))           # [B,1]
        txt = mx.take_along_axis(trail, idx[:, :, None], axis=1)                        # [B,1,H]
        txt = mx.where((t < tl)[:, :, None], txt, pad)
        inp = txt + cemb
        hist = mx.concatenate([hist[:, 1:], first], axis=1)
        mask = mx.concatenate([mask, mx.ones((B, 1), dtype=mask.dtype)], axis=1)
        codes.append(allc)
        mx.async_eval(inp, finished, allc, hist, done_at)
        if prev_finished is not None and bool(mx.all(prev_finished).item()):      # end flags are read one step late
            break
        prev_finished = finished
    mx.eval(done_at)
    C = mx.stack(codes, axis=1)                                                         # [B,T,16]
    da = np.array(done_at); da = np.where(da < 0, C.shape[1], da)
    outs = []
    dec = model.speech_tokenizer.decoder
    for b in range(B):
        n_ = int(da[b])
        if n_ == 0: outs.append(np.zeros(0, np.float32)); continue
        dec.reset_streaming_state(); parts = []
        cb = mx.transpose(C[b:b + 1, :n_], (0, 2, 1))
        for c0 in range(0, n_, chunk):
            w = dec.streaming_step(cb[:, :, c0:c0 + chunk]).squeeze(1)[0]
            parts.append(np.array(w.astype(mx.float32)).reshape(-1))
        dec.reset_streaming_state(); outs.append(np.concatenate(parts)); mx.clear_cache()
    return outs
