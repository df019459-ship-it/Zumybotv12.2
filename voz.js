import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const nomeZumy = /(?<![\p{L}\p{N}_])zumy(?![\p{L}\p{N}_])/giu;
const normalize = value => value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

export const chamouZumy = texto => new RegExp(nomeZumy.source, 'iu').test(texto);

export const estilosVoz = Object.freeze({
  anime: { voice: 'shimmer', style: 'Voz original com estilo de personagem feminina de anime. Alegre, expressiva e brincalhona, com entonação natural e ritmo leve.' },
  doce: { voice: 'coral', style: 'Fale com voz suave, acolhedora e sorridente, como numa conversa entre amigos.' },
  calma: { voice: 'marin', style: 'Fale em tom calmo e gentil, com ritmo tranquilo e pausas naturais.' },
  grave: { voice: 'cedar', style: 'Use tom mais grave e descontraído, com entonação natural.' },
});

export function periodoDoDia(data = new Date(), timeZone = 'America/Fortaleza') {
  const hora = Number(new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(data));
  if (hora < 5) return 'Boa madrugada!';
  if (hora < 12) return 'Bom dia!';
  if (hora < 18) return 'Boa tarde!';
  return 'Boa noite!';
}

function prepararResposta(texto, saudacao) {
  const fala = texto.replace(nomeZumy, ' ').replace(/\s+/g, ' ').trim();
  const limpa = normalize(fala).replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (/\b(tudo bem|como (voce )?(esta|ta|vai)|como ce ta|como c[eê] esta|voce (esta|ta) bem|e ai tudo certo|ta tudo bem)\b/.test(limpa)) {
    return { resposta: 'Tô bem, sim! Obrigada por perguntar. E você, como tá?' };
  }
  if (/\b(quem (e|eh) voce|qual (e )?seu nome|se apresent[ae])\b/.test(limpa)) {
    return { resposta: 'Eu sou a Zumy, a assistente virtual do grupo. Pode falar comigo pelo meu nome.' };
  }
  if (/^(oi|ola|opa|e ai|ei|bom dia|boa tarde|boa noite|boa madrugada|salve)( (a )?todos)?$/.test(limpa) || !limpa) {
    return { resposta: saudacao + ' Oi, aqui é a Zumy. Tô te ouvindo!' };
  }
  if (/\b(toca|tocar|mande|manda|envie|envia)\b.*\b(musica|audio)\b/.test(limpa)) {
    return { resposta: 'Pra escolher uma música, use exclamação play lista no grupo.' };
  }
  if (/\b(ajuda|me ajuda|comandos|como funciona)\b/.test(limpa) && limpa.split(' ').length <= 5) {
    return { resposta: 'Claro! Você pode me fazer uma pergunta ou digitar exclamação menu para ver o que posso fazer.' };
  }
  return { pergunta: fala.replace(/^[,!.?;: ]+/, '').slice(0, 500) };
}

async function gerarAudio(texto, estilo, chave, consultar) {
  const response = await consultar('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + chave, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts', voice: estilo.voice, input: texto, response_format: 'wav',
      instructions: 'Fale em português brasileiro. Pronuncie Zumy como Zumi. ' + estilo.style,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const erro = await response.json().catch(() => ({}));
    throw Object.assign(new Error('Falha no serviço de voz'), { status: response.status, code: erro.error?.code });
  }
  const wav = Buffer.from(await response.arrayBuffer());
  if (wav.subarray(0, 4).toString() !== 'RIFF') throw new Error('A API não retornou WAV.');
  const folder = await mkdtemp(join(tmpdir(), 'zumy-voz-'));
  try {
    const input = join(folder, 'fala.wav');
    const output = join(folder, 'fala.ogg');
    await writeFile(input, wav);
    await exec('ffmpeg', ['-nostdin', '-v', 'error', '-i', input, '-c:a', 'libopus',
      '-ac', '1', '-ar', '48000', '-application', 'voip', output], { timeout: 10000 });
    return await readFile(output);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

export function criarVoz({ env = process.env, logger = console, consultar = fetch, gerar = gerarAudio, perguntar } = {}) {
  const timeZone = env.BOT_TIMEZONE || 'America/Fortaleza';
  const chave = env.OPENAI_API_KEY?.trim();
  const audios = new Map();
  const files = new Map();
  const disclosures = new Set();

  async function falar({ settings, update, send, jid }, texto) {
    if (!chave && gerar === gerarAudio) throw new Error('Configure OPENAI_API_KEY no Render.');
    const nome = Object.hasOwn(estilosVoz, settings.voiceStyle) ? settings.voiceStyle : 'anime';
    const cacheKey = nome + ':' + texto;
    if (!audios.has(cacheKey)) {
      if (audios.size >= 32) audios.delete(audios.keys().next().value);
      audios.set(cacheKey, Promise.resolve().then(() => gerar(texto, estilosVoz[nome], chave, consultar)));
    }
    try {
      const audio = await audios.get(cacheKey);
      if (!settings.voiceDisclosed && !disclosures.has(jid)) {
        await send({ text: '🎙️ A voz da Zumy é gerada por inteligência artificial.' }, { citar: false });
        update({ voiceDisclosed: true });
        if (disclosures.size >= 500) disclosures.delete(disclosures.values().next().value);
        disclosures.add(jid);
      }
      return await send({ audio, mimetype: 'audio/ogg; codecs=opus', ptt: true });
    } catch (error) {
      audios.delete(cacheKey);
      throw error;
    }
  }

  function enfileirar(context, callback) {
    const fila = files.get(context.jid) || { tarefa: Promise.resolve(), total: 0 };
    if (fila.total >= 8) return;
    files.set(context.jid, fila);
    fila.total++;
    fila.tarefa = fila.tarefa.then(callback).catch(error => {
      logger.warn({ status: error.status, code: error.code, name: error.name }, 'Falha na voz do ZUMY');
    }).finally(() => {
      if (--fila.total === 0) files.delete(context.jid);
    });
    return fila.tarefa;
  }

  function narrar(context, texto) {
    if (!texto || (!chave && gerar === gerarAudio)) return;
    return enfileirar(context, () => falar(context, texto));
  }

  function conversar(context) {
    const entrou = enfileirar(context, async () => {
      const saudacao = periodoDoDia(new Date(), timeZone);
      const pedido = prepararResposta(context.text, saudacao);
      const resposta = pedido.resposta || (chave && perguntar ? await perguntar(pedido.pergunta) : '') ||
        'Vi sua mensagem: ' + pedido.pergunta + '. Minha conexão com a inteligência artificial está indisponível agora.';
      const fala = String(resposta).trim().slice(0, 650);
      try {
        await falar(context, fala);
      } catch (error) {
        logger.warn({ status: error.status, code: error.code, name: error.name }, 'Falha na voz do ZUMY');
        await context.reply(fala);
      }
    });
    if (!entrou) return context.reply('Recebi sua mensagem. Estou respondendo às anteriores, tente novamente em instantes.');
  }

  async function testar(context) {
    try {
      await falar(context, 'Oi! Aqui é a Zumy. Minha voz está funcionando!');
    } catch (error) {
      logger.warn({ status: error.status, code: error.code, name: error.name }, 'Falha na voz do ZUMY');
      if (!chave) return context.reply('Voz indisponível. Configure OPENAI_API_KEY no Render.');
      if (error.code === 'insufficient_quota') return context.reply('Voz indisponível. A API da OpenAI está sem cota.');
      if (error.status === 401) return context.reply('Voz indisponível. A OpenAI recusou a chave configurada no Render.');
      return context.reply('Voz indisponível. ' + (error.status ? 'OpenAI retornou HTTP ' + error.status + '.' : 'Confira “Falha na voz do ZUMY” nos logs do Render.'));
    }
  }

  return { narrar, conversar, testar };
}
