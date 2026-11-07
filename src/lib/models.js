/**
 * The model registry — every model id the page can reach lives here, so there
 * is one place to update when a repo gets renamed on the Hub.
 *
 * `alts` are fallbacks tried in order: Hugging Face repos do get moved, and a
 * tokenizer that quietly disappears should not take the whole panel with it.
 * Only `tokenizer.json` + config files are fetched for these (a few hundred KB
 * each), never weights.
 */

export const TOKENIZERS = [
  {
    id: 'gpt2',
    label: 'GPT-2',
    repo: 'Xenova/gpt2',
    alts: ['onnx-community/gpt2'],
    family: 'byte-level BPE',
    vocab: 50257,
    context: 1024,
    era: '2019 · GPT-2 / GPT-3',
    byteLevel: true,
    defaultOn: true,
  },
  {
    id: 'llama3',
    label: 'Llama 3',
    repo: 'Xenova/Meta-Llama-3-8B-Instruct',
    alts: ['onnx-community/Llama-3.2-1B-Instruct', 'Xenova/Llama-3.2-1B-Instruct'],
    family: 'byte-level BPE',
    vocab: 128256,
    context: 8192,
    era: '2024 · Llama 3',
    byteLevel: true,
    defaultOn: true,
  },
  {
    id: 'qwen',
    label: 'Qwen2.5',
    repo: 'Xenova/Qwen2.5-0.5B-Instruct',
    alts: ['onnx-community/Qwen2.5-0.5B-Instruct'],
    family: 'byte-level BPE',
    vocab: 151665,
    context: 32768,
    era: '2024 · Qwen2.5',
    byteLevel: true,
    defaultOn: false,
  },
  {
    id: 'bert',
    label: 'BERT',
    repo: 'Xenova/bert-base-uncased',
    alts: ['google-bert/bert-base-uncased'],
    family: 'WordPiece',
    vocab: 30522,
    context: 512,
    era: '2018 · encoder',
    byteLevel: false,
    defaultOn: true,
  },
  {
    id: 't5',
    label: 'T5',
    repo: 'Xenova/t5-small',
    alts: ['Xenova/t5-base'],
    family: 'Unigram',
    vocab: 32100,
    context: 512,
    era: '2019 · encoder-decoder',
    byteLevel: false,
    defaultOn: false,
  },
];

export function tokenizerById(id) {
  return TOKENIZERS.find((model) => model.id === id);
}

/** The embedding model behind every similarity number on the page. */
export const EMBEDDER = {
  id: 'minilm',
  label: 'all-MiniLM-L6-v2',
  repo: 'Xenova/all-MiniLM-L6-v2',
  alts: ['onnx-community/all-MiniLM-L6-v2-ONNX'],
  dimensions: 384,
  maxTokens: 512,
  approxBytes: 23 * 1024 * 1024,
};

/* ------------------------------------------------------------------------ */
/*  Example content                                                          */
/* ------------------------------------------------------------------------ */

export const SAMPLES = {
  english:
    'The quick brown fox jumps over the lazy dog. Antidisestablishmentarianism is surprisingly easy to tokenize!',
  multilingual: 'नमस्ते दुनिया! こんにちは世界. مرحبا بالعالم. 你好，世界。 🌏🚀',
  code: 'const cosine = (a, b) => dot(a, b) / (norm(a) * norm(b)); // 384 dims',
  numbers: 'In 2024 the invoice totalled $1,234,567.89 — a 42.7% increase over Q3.',
  emoji: '🤖✨📈🌍💡🧠🚀🔥💯🎯',
};

/**
 * The multilingual panel: one meaning, many languages. Token counts diverge
 * sharply here, which is the whole point — same content, different price.
 */
export const LANGUAGE_SAMPLES = [
  {
    code: 'en',
    label: 'English',
    text: 'Artificial intelligence is changing how we work and learn.',
    note: 'Latin script, 1 byte per character',
  },
  {
    code: 'hi',
    label: 'Hindi',
    text: 'कृत्रिम बुद्धिमत्ता हमारे काम करने और सीखने का तरीका बदल रही है।',
    note: 'Devanagari, 3 bytes per character',
  },
  {
    code: 'bn',
    label: 'Bengali',
    text: 'কৃত্রিম বুদ্ধিমত্তা আমাদের কাজ করার এবং শেখার পদ্ধতি পরিবর্তন করছে।',
    note: 'Bengali script, 3 bytes per character',
  },
  {
    code: 'ta',
    label: 'Tamil',
    text: 'செயற்கை நுண்ணறிவு நாம் வேலை செய்யும் மற்றும் கற்கும் விதத்தை மாற்றுகிறது.',
    note: 'Tamil script, 3 bytes per character',
  },
  {
    code: 'zh',
    label: 'Chinese',
    text: '人工智能正在改变我们工作和学习的方式。',
    note: 'Han characters, 3 bytes each',
  },
  {
    code: 'ja',
    label: 'Japanese',
    text: '人工知能は私たちの働き方と学び方を変えています。',
    note: 'Mixed kanji + kana',
  },
  {
    code: 'ar',
    label: 'Arabic',
    text: 'الذكاء الاصطناعي يغيّر طريقة عملنا وتعلّمنا.',
    note: 'Arabic script, right-to-left',
  },
];

export const DEFAULT_CORPUS = [
  'A man is playing a guitar on stage.',
  'A musician performs a concert for the crowd.',
  'The guitarist strums a chord during the show.',
  'A chef is chopping vegetables in the kitchen.',
  'Someone is cooking dinner at home.',
  'A dog chases a ball across the park.',
  'A puppy runs after a toy in the garden.',
  'The stock market fell sharply this morning.',
  'Investors sold shares after the earnings report.',
  'A cat is sleeping on the windowsill.',
];

export const DEFAULT_PAIR = {
  a: 'A man is playing a guitar on stage.',
  b: 'A musician performs a concert for the crowd.',
};

/**
 * Pairs that break naive intuition. Antonyms and homonyms sit *close* in
 * embedding space — saying so out loud is what separates a good explainer
 * from a misleading one.
 */
export const TRICKY_PAIRS = [
  {
    label: 'antonyms',
    a: 'I love this film, it made me happy.',
    b: 'I hate this film, it made me miserable.',
    lesson: 'Opposites share almost every other word — expect a high score.',
  },
  {
    label: 'homonyms',
    a: 'We sat on the river bank.',
    b: 'She deposited cash at the bank.',
    lesson: 'One word, two meanings: a single vector cannot tell them apart.',
  },
  {
    label: 'paraphrase',
    a: 'The meeting has been postponed until Friday.',
    b: 'They pushed the meeting back to Friday.',
    lesson: 'Different words, identical meaning — this is what embeddings are for.',
  },
  {
    label: 'unrelated',
    a: 'The meeting has been postponed until Friday.',
    b: 'Bananas are rich in potassium.',
    lesson: 'Nothing shared, low score.',
  },
];

export const MODELS_LOADED_NOTE =
  'Models stream from the Hugging Face Hub on first use, then live in your browser cache.';
