import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { prefix } from './menu.js';

const ffmpeg = promisify(execFile);
const maxMediaBytes = 8 * 1024 * 1024;

async function convert({ data, text, animated = false, toImage = false, color = '151827' }) {
  const folder = await mkdtemp(join(tmpdir(), 'zumy-'));
  try {
    const output = join(folder, toImage ? 'out.png' : 'out.webp');
    const input = join(folder, 'input');
    const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-threads', '1', '-filter_threads', '1'];
    if (text) {
      await writeFile(input, text);
      args.push('-f', 'lavfi', '-i', 'color=c=0x' + color + ':s=512x512:r=10');
      const draw = 'drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:' +
        'textfile=input:expansion=none:fontsize=41:line_spacing=8:x=(w-tw)/2:y=(h-th)/2:fontcolor=';
      const colors = ['f6d365', '84fab0', '99ccff', 'ff92ae'];
      const filter = animated ? colors.map((color, index) =>
        draw + color + ":enable='between(t," + index / 2 + ',' + (index / 2 + 0.49) + ")'").join(',') :
        draw + 'ffffff';
      args.push('-vf', filter);
    } else {
      await writeFile(input, data);
      args.push('-protocol_whitelist', 'file', '-i', input);
      if (!toImage) {
        args.push('-vf', (animated ? 'fps=10,' : '') + 'scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000');
      }
    }
    if (toImage || !animated) args.push('-frames:v', '1');
    else args.push('-t', text ? '2' : '5', '-loop', '0');
    if (!toImage) args.push('-c:v', animated ? 'libwebp_anim' : 'libwebp', '-quality', '65');
    await ffmpeg('ffmpeg', [...args, '-an', output], { cwd: folder, timeout: 20000 });
    const buffer = await readFile(output);
    if (!buffer.length) throw new Error('FFmpeg não gerou um arquivo de saída.');
    return buffer;
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

async function requestJson(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('Serviço externo retornou HTTP ' + response.status);
  return response.json();
}

const maxAudioBytes = 12 * 1024 * 1024;
const audioTypes = new Map([
  ['audio/mpeg', 'audio/mpeg'],
  ['audio/mp3', 'audio/mpeg'],
  ['audio/x-mp3', 'audio/mpeg'],
  ['audio/mp4', 'audio/mp4'],
  ['audio/x-m4a', 'audio/mp4'],
]);

const genericDownloadTypes = new Set([
  '', 'application/octet-stream', 'binary/octet-stream', 'application/force-download',
  'application/download', 'application/x-download',
]);

async function confirmMp3(audio) {
  const folder = await mkdtemp(join(tmpdir(), 'zumy-audio-'));
  try {
    const file = join(folder, 'track.mp3');
    await writeFile(file, audio);
    const { stdout } = await ffmpeg('ffprobe', [
      '-v', 'error', '-protocol_whitelist', 'file', '-f', 'mp3', '-i', file,
      '-select_streams', 'a:0', '-show_entries', 'stream=codec_name',
      '-of', 'default=noprint_wrappers=1:nokey=1',
    ], { timeout: 5000, maxBuffer: 8192 });
    if (stdout.trim() !== 'mp3') throw new Error('Codec diferente de MP3.');
  } catch (error) {
    if (error.code === 'ENOENT') throw error;
    throw new Error('O arquivo recebido não contém áudio MP3 válido.');
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

async function readAudio(response, { allowGenericMp3 = false, allowVideo = false } = {}) {
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || '';
  const knownType = allowVideo && contentType === 'video/mp4' ? contentType : audioTypes.get(contentType);
  const checkMp3 = !knownType && allowGenericMp3 && genericDownloadTypes.has(contentType);
  if ((!knownType && !checkMp3) || !response.body) {
    await response.body?.cancel();
    throw new Error('O endereço precisa fornecer um arquivo ' + (allowVideo ? 'MP3, M4A ou MP4' : 'MP3 ou M4A') + '. Tipo recebido: ' +
      (contentType.slice(0, 80) || 'não informado') + '.');
  }
  if (Number(response.headers.get('content-length')) > maxAudioBytes) {
    await response.body.cancel();
    throw new Error('O áudio pode ter até 12 MB.');
  }

  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.byteLength;
    if (length > maxAudioBytes) throw new Error('O áudio pode ter até 12 MB.');
    chunks.push(chunk);
  }
  if (!length) throw new Error('O arquivo de áudio está vazio.');
  const audio = Buffer.concat(chunks, length);
  if (checkMp3) await confirmMp3(audio);
  if (knownType === 'video/mp4') return { video: audio, mimetype: knownType };
  return { audio, mimetype: knownType || 'audio/mpeg', ptt: false };
}

function audioOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.origin;
  } catch {
    return undefined;
  }
}

function jamendoMediaUrl(value) {
  const origin = audioOrigin(value);
  if (!origin) return false;
  const url = new URL(value);
  return !url.port && /(?:^|\.)jamendo\.com$/i.test(url.hostname);
}

async function downloadJamendo(url) {
  const signal = AbortSignal.timeout(20000);
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (!jamendoMediaUrl(url)) throw new Error('Origem de áudio do catálogo não reconhecida.');
    const response = await fetch(url, { redirect: 'manual', signal });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('O catálogo retornou um redirecionamento inválido.');
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('O catálogo retornou HTTP ' + response.status);
    }
    return readAudio(response, { allowGenericMp3: true });
  }
  throw new Error('O catálogo retornou muitos redirecionamentos.');
}

const archiveOrigin = 'https://archive.org';
const archiveItem = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,149}$/;
const archiveLicensePath = /^\/(?:licenses\/(?:by|by-sa)\/(?:1\.0|2\.0|2\.5|3\.0|4\.0)(?:\/[a-z-]+)?|publicdomain\/zero\/1\.0)\/?$/i;

function licensedArchiveItem(record) {
  const licenses = [record?.metadata?.licenseurl].flat();
  if (licenses.length !== 1 || !licenses[0]) return;
  try {
    const url = new URL(licenses[0]);
    if (!['https:', 'http:'].includes(url.protocol) || url.hostname !== 'creativecommons.org' ||
        url.port || url.username || url.password || !archiveLicensePath.test(url.pathname)) return;
    return 'https://creativecommons.org' + url.pathname;
  } catch {
    return;
  }
}

function archiveLink(arg) {
  try {
    const url = new URL(arg);
    if (url.origin !== archiveOrigin || url.username || url.password) return;
    const [, route, id, ...rest] = url.pathname.replace(/\/$/, '').split('/');
    if (route !== 'details' || !archiveItem.test(id) || rest.length) return;
    return id;
  } catch {
    return;
  }
}

async function downloadArchive(url, video) {
  const signal = AbortSignal.timeout(20000);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const next = new URL(url);
    if (next.protocol !== 'https:' || next.port || next.username || next.password ||
        !/(?:^|\.)archive\.org$/i.test(next.hostname)) {
      throw new Error('O Archive redirecionou para um endereço fora do catálogo.');
    }
    const response = await fetch(next, { redirect: 'manual', signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('Redirecionamento do Archive sem endereço.');
      url = new URL(location, next).href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Download do Archive retornou HTTP ' + response.status);
    }
    const media = await readAudio(response, { allowGenericMp3: !video, allowVideo: video });
    if (video && !media.video) throw new Error('O item não retornou um vídeo MP4.');
    if (!video && media.mimetype !== 'audio/mpeg') throw new Error('O item não retornou MP3.');
    return media;
  }
  throw new Error('O Archive retornou muitos redirecionamentos.');
}

function chooseArchiveFile(record, extension, query, strictTitle) {
  const files = (Array.isArray(record.files) ? record.files : []).filter(file => {
    const size = Number(file?.size);
    return typeof file?.name === 'string' && !/[\\/]/.test(file.name) &&
      file.name.toLowerCase().endsWith('.' + extension) && Number.isSafeInteger(size) &&
      size > 0 && size <= maxAudioBytes && !file.private;
  });
  if (!query) return files[0];
  const title = trackName(query);
  const match = files.find(file => trackName(String(file.title || file.name)).includes(title));
  if (match || !strictTitle || trackName(String(record.metadata?.title || '')).includes(title)) return match || files[0];
}

const localTracks = [
  ['opera_o_anti_z_gavi_o.mp3', ['opera', 'opera o anti z gavi o']],
  ['estou_apaixonado.m4a', ['estou apaixonado', 'daniel', 'estoy enamorado']],
  ['interrogacoes.m4a', ['interrogacoes', 'all star brasil']],
  ['AUD-20261016-WA0254.mp3', ['produção dj tk', 'wa0254', 'aud 20261016 wa0254']],
  ['viu_mulher_mudou_o_tom.mp3', ['viu mulher mudou o tom']],
  ['minha_princesa_complicada.mp3', ['minha princesa complicada']],
  ['lunes_que_sabe_a_viernes.mp3', ['lunes que sabe a viernes']],
  ['la_diabla_mexicana.mp3', ['la diabla mexicana']],
];

const trackName = value => value.trim().toLowerCase().normalize('NFD')
  .replace(/\p{M}/gu, '').replace(/\.(mp3|m4a)$/i, '').replace(/[_|–—-]/g, ' ')
  .replace(/\s+/g, ' ').trim();
const fileByName = new Map(localTracks.flatMap(([file, aliases]) =>
  [file, ...aliases].map(alias => [trackName(alias), file])));

export function createIntegrations({ downloadMedia, logger = console, env = process.env } = {}) {
  async function media(context, command) {
    const { arg, source, download, reply, send } = context;
    const toImage = command === 'toimg';
    const fromText = command === 'ttp' || command === 'attp';
    const mediaType = source.stickerMessage || source.imageMessage || source.videoMessage;
    if (fromText && (!arg || [...arg].length > 60)) return reply('Use ' + prefix + command + ' com até 60 caracteres.');
    if (!fromText && (toImage ? !source.stickerMessage : !mediaType)) {
      return reply(toImage ? 'Responda a uma figurinha com !toimg.' : 'Envie uma imagem ou vídeo curto com !fig, ou responda à mídia.');
    }
    if (!fromText && Number(mediaType.fileLength) > maxMediaBytes) return reply('A mídia pode ter até 8 MB.');
    try {
      const data = fromText ? undefined : await download(downloadMedia);
      if (data && data.length > maxMediaBytes) return reply('A mídia pode ter até 8 MB.');
      const text = fromText ? (arg.replace(/\s+/g, ' ').match(/.{1,14}/gu) || []).join('\n') : undefined;
      const buffer = await convert({ data, text, toImage, animated: command === 'attp' || (!toImage && !!source.videoMessage) });
      if (!toImage && buffer.length > 500 * 1024) return reply('A figurinha ficou muito grande. Tente uma mídia mais curta.');
      return send(toImage ? { image: buffer, mimetype: 'image/png' } : { sticker: buffer });
    } catch (error) {
      logger.warn({ err: error.message, command }, 'Falha ao converter mídia');
      return reply('Não consegui converter essa mídia. Tente outra imagem, vídeo ou figurinha.');
    }
  }

  async function playByName({ arg, reply, send }) {
    const clientId = env.JAMENDO_CLIENT_ID;
    if (!clientId) {
      return reply('O dono precisa configurar JAMENDO_CLIENT_ID no Render para tocar por nome. Você também pode usar !play com um link direto.');
    }
    if (arg.length > 150) return reply('Busque um título de até 150 caracteres.');
    const [title, artist] = arg.split('|', 2).map(piece => piece.trim());
    if (!title) return reply('Use !play NOME DA MÚSICA ou !p NOME | ARTISTA.');
    const query = new URLSearchParams({
      client_id: clientId,
      format: 'json',
      namesearch: title,
      limit: '10',
      type: 'single albumtrack',
    });
    if (artist) query.set('artist_name', artist);
    try {
      const data = await requestJson('https://api.jamendo.com/v3.0/tracks/?' + query);
      if (data.headers?.status !== 'success') return reply('O catálogo não aceitou a busca. Confira a configuração do Jamendo.');
      const tracks = (data.results || []).filter(track =>
        track.audiodownload_allowed === true && /^\d+$/.test(String(track.id)));
      const normalize = value => String(value || '').trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
      const track = tracks.find(item => normalize(item.name) === normalize(title)) || tracks[0];
      if (!track) return reply('Nenhuma faixa com download autorizado nesse catálogo. Tente o nome exato ou NOME | ARTISTA.');

      const downloadQuery = new URLSearchParams({
        client_id: clientId,
        id: String(track.id),
        action: 'download',
        audioformat: 'mp32',
      });
      const audio = await downloadJamendo('https://api.jamendo.com/v3.0/tracks/file/?' + downloadQuery);
      const source = jamendoMediaUrl(track.shareurl) ? '\n' + track.shareurl : '';
      const license = /^https:\/\/creativecommons\.org\//.test(track.license_ccurl || '') ? '\nLicença: ' + track.license_ccurl : '';
      await reply('🎵 ' + track.name + ' — ' + track.artist_name + source + license);
      return await send(audio);
    } catch (error) {
      logger.warn({ err: error.message }, 'Falha ao buscar áudio por nome');
      return reply('Não consegui baixar essa faixa do catálogo agora.');
    }
  }

  async function playLocal({ reply, send }, filename) {
    const file = new URL('./' + filename, import.meta.url);
    try {
      const info = await stat(file);
      if (!info.isFile() || !info.size || info.size > maxAudioBytes) {
        return reply('O arquivo local precisa ser um MP3 ou M4A de até 12 MB.');
      }
      const audio = await readFile(file);
      return await send({ audio, mimetype: filename.endsWith('.m4a') ? 'audio/mp4' : 'audio/mpeg', ptt: false });
    } catch (error) {
      logger.warn({ code: error.code }, 'Falha ao enviar áudio local');
      return reply('Não consegui enviar o áudio local. Confira se ele está na raiz do projeto publicado.');
    }
  }

  async function playArchive({ arg, reply, send }, requestedId) {
    const [, extension, term] = /^(?:(mp3|mp4)\s+)?([\s\S]+)$/i.exec(arg.trim()) || [];
    const format = extension?.toLowerCase() || 'mp3';
    const id = requestedId || (term && archiveLink(term));
    const apenasArtista = /^artista(?:\s|$)/i.test(term || '');
    const entrada = (term || '').replace(/^artista(?:\s+|$)/i, '');
    const limpar = value => value.replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
    const [primeira, segunda] = entrada.split('|', 2).map(limpar);
    const titulo = apenasArtista ? '' : primeira;
    const artista = apenasArtista ? primeira : segunda || '';
    if (!id && ((!titulo && !artista) || titulo.length + artista.length > 120)) {
      return reply('Use !play artista NOME ou !play archive MÚSICA | ARTISTA. Para vídeo, use !play archive mp4 NOME.');
    }
    const buscaExterna = 'https://www.youtube.com/results?search_query=' +
      encodeURIComponent([titulo, artista].filter(Boolean).join(' '));
    const getItem = identifier => requestJson(archiveOrigin + '/metadata/' + encodeURIComponent(identifier));
    try {
      let ids = id ? [id] : [];
      if (!id) {
        const search = new URL('/advancedsearch.php', archiveOrigin);
        const filtro = artista
          ? (titulo ? ' AND title:"' + titulo + '"' : '') + ' AND creator:"' + artista + '"'
          : ' AND (title:"' + titulo + '" OR creator:"' + titulo + '")';
        search.searchParams.set('q', 'mediatype:' + (format === 'mp4' ? 'movies' : 'audio') +
          filtro + ' AND licenseurl:*');
        search.searchParams.set('fl[]', 'identifier');
        search.searchParams.set('output', 'json');
        search.searchParams.set('rows', '4');
        const data = await requestJson(search);
        ids = (data.response?.docs || []).map(doc => doc.identifier).filter(value => archiveItem.test(value || ''));
      }
      const results = await Promise.allSettled(ids.map(getItem));
      let lastError = results.find(result => result.status === 'rejected')?.reason;
      for (let i = 0; i < ids.length; i++) {
        const record = results[i].value;
        if (!record || record.is_dark || record.metadata?.['access-restricted-item']) continue;
        const license = licensedArchiveItem(record);
        if (!license) continue;
        const creator = [record.metadata.creator].flat().filter(Boolean).join(', ').slice(0, 180);
        if (!id && artista && !trackName(creator).includes(trackName(artista))) continue;
        const file = chooseArchiveFile(record, format, id ? '' : titulo, Boolean(!id && artista && titulo));
        if (!file) continue;
        const page = archiveOrigin + '/details/' + encodeURIComponent(ids[i]);
        const raw = archiveOrigin + '/download/' + encodeURIComponent(ids[i]) + '/' + encodeURIComponent(file.name);
        let media;
        try { media = await downloadArchive(raw, format === 'mp4'); }
        catch (error) { lastError = error; continue; }
        const title = String(file.title || record.metadata.title || file.name).slice(0, 180);
        const credit = title + (creator ? ' — ' + creator : '') + '\nFonte: ' + page + '\nLicença: ' + license;
        if (media.video) return await send({ ...media, caption: credit });
        await reply(credit);
        return await send(media);
      }
      if (lastError) {
        logger.warn({ name: lastError.name, err: lastError.message }, 'Falha no Internet Archive');
        return reply('O Internet Archive não entregou o arquivo agora. Tente novamente ou use outro item.');
      }
      return reply('Não encontrei um ' + format.toUpperCase() +
        ' de até 12 MB com licença de compartilhamento confirmada no Internet Archive.' +
        (id ? '\n' + archiveOrigin + '/details/' + encodeURIComponent(id) : '\nBuscar no YouTube: ' + buscaExterna));
    } catch (error) {
      logger.warn({ name: error.name, err: error.message }, 'Falha na busca do Internet Archive');
      return reply('O Internet Archive está indisponível para esta busca. Tente novamente em instantes.');
    }
  }

  async function playAudio({ arg, reply, send }) {
    if (!arg || trackName(arg) === 'lista') {
      return reply('🎵 Áudios cadastrados\n' + localTracks.map(([, [name]]) => '!play ' + name).join('\n') +
        '\n\nCatálogo externo: !play artista NOME ou !play archive MÚSICA | ARTISTA');
    }
    const name = trackName(arg);
    const localFile = fileByName.get(name);
    if (localFile) return playLocal({ reply, send }, localFile);
    const audiusLink = 'https://audius.co/BellMarques/ver%C3%A3o';
    if (['verao', 'verao bell marques'].includes(name) || arg === audiusLink) {
      return reply('🎵 VERÃO — Bell Marques\n' + audiusLink);
    }
    if (/^artista(?:\s|$)/i.test(arg)) return playArchive({ arg, reply, send });
    if (/^archive(?:\s|$)/i.test(arg)) return playArchive({ arg: arg.slice(7), reply, send });
    const item = archiveLink(arg);
    if (item) return playArchive({ arg, reply, send }, item);
    const origin = audioOrigin(arg);
    if (!origin) {
      if (/^\w+:\/\//.test(arg)) return reply('Use um link HTTPS direto de um MP3, M4A ou MP4.');
      return playByName({ arg, reply, send });
    }
    const approvedOrigin = audioOrigin(env.MUSIC_AUDIO_ORIGIN);
    if (!approvedOrigin) return reply('O dono precisa configurar MUSIC_AUDIO_ORIGIN no Render com o endereço do servidor de áudio.');
    if (origin !== approvedOrigin) return reply('Use um link direto do servidor de áudio cadastrado pelo dono.');
    let response;
    try {
      response = await fetch(arg, {
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return reply('O servidor de áudio retornou HTTP ' + response.status + '.');
      }
      const audio = await readAudio(response, { allowGenericMp3: true, allowVideo: true });
      return await send(audio);
    } catch (error) {
      logger.warn({ err: error.message }, 'Falha ao enviar áudio');
      if (/^(O endereço|O áudio|O arquivo)/.test(error.message)) return reply(error.message);
      return reply('Não consegui enviar o áudio. Confira se o link é direto e tente novamente.');
    }
  }

  async function music({ arg, reply }, command) {
    if (!arg) return reply('Use ' + prefix + command + ' nome da música ou artista.');
    if (command === 'letra') {
      return reply('🎵 Buscar letra: https://www.google.com/search?q=' + encodeURIComponent(arg + ' letra'));
    }
    const query = new URLSearchParams({ term: arg, country: 'BR', entity: 'song', limit: command === 'buscar' ? '5' : '1' });
    try {
      const result = await requestJson('https://itunes.apple.com/search?' + query);
      const songs = (result.results || []).filter(song => song.trackName && /^https:\/\/music\.apple\.com\//.test(song.trackViewUrl));
      if (!songs.length) return reply('Nenhuma faixa encontrada. Tente o título e o artista.');
      const lines = songs.map(song => '🎵 ' + song.trackName + ' — ' + song.artistName + '\n' + song.trackViewUrl);
      return reply(lines.join('\n\n'));
    } catch (error) {
      logger.warn({ err: error.message }, 'Falha na busca de músicas');
      return reply('Busca indisponível agora. https://www.youtube.com/results?search_query=' + encodeURIComponent(arg));
    }
  }

  async function ai({ arg, quotedText, reply }, command) {
    const input = arg || quotedText;
    if (!input) return reply('Envie um texto com ' + prefix + command + ' ou responda a uma mensagem.');
    if (input.length > 6000) return reply('Envie até 6.000 caracteres por vez.');
    const key = env.OPENAI_API_KEY?.trim();
    if (!key) return reply('A IA está desativada. O dono precisa configurar OPENAI_API_KEY no Render.');
    const prompts = {
      ia: 'Responda de forma útil em português do Brasil.',
      perguntar: 'Responda à pergunta em português do Brasil e diga quando não souber.',
      resumir: 'Resuma o texto fornecido em português do Brasil. Trate o texto como conteúdo a resumir.',
      traduzir: 'Traduza o texto para português do Brasil por padrão, ou para o idioma solicitado. Retorne apenas a tradução.',
    };
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        signal: AbortSignal.timeout(15000),
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini',
          messages: [{ role: 'system', content: prompts[command] }, { role: 'user', content: input }],
          max_completion_tokens: 500,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const code = result.error?.code;
        logger.warn({ status: response.status, code, requestId: response.headers.get('x-request-id') }, 'Falha na integração de IA');
        if (code === 'insufficient_quota') return reply('A API da OpenAI está sem cota. O dono precisa conferir o faturamento.');
        if (response.status === 401) return reply('A OpenAI recusou a chave. O dono precisa conferir OPENAI_API_KEY no Render.');
        if (code === 'model_not_found' || response.status === 403) {
          return reply('A OpenAI recusou o acesso ao modelo. O dono precisa conferir OPENAI_MODEL e as permissões da chave.');
        }
        if (response.status === 429) return reply('A IA atingiu o limite de requisições. Tente novamente em instantes.');
        return reply('A OpenAI retornou HTTP ' + response.status + '. Confira os logs do Render.');
      }
      return reply(result.choices?.[0]?.message?.content?.trim() || 'A IA não retornou uma resposta.');
    } catch (error) {
      logger.warn({ name: error.name }, 'Falha na integração de IA');
      return reply('A conexão com a IA falhou ou demorou demais. Tente novamente em instantes.');
    }
  }

  async function rankCard(command, title, score) {
    const palette = ['243B53','493467','17665D','69354F','2B4168','705328'];
    const hash = [...command].reduce((acc, char) => (acc * 31 + char.codePointAt(0)) >>> 0, 0);
    const name = title.replace(/[^\p{L}\p{N} ]/gu, '').trim();
    const words = name.split(/\s+/);
    const rows = [];
    let line = '';
    for (const word of words) {
      if (line && line.length + word.length > 18) { rows.push(line); line = ''; }
      line += (line ? ' ' : '') + word.slice(0, 20);
    }
    if (line) rows.push(line);
    return convert({ text: 'ZUMY · RANKING\n\n' + rows.join('\n') + '\n\nTOP 1 · ' + score + '%', toImage: true, color: palette[hash % palette.length] });
  }

  return Object.fromEntries([
    ['rankCard', rankCard],
    ...['fig', 'sticker', 'toimg', 'ttp', 'attp'].map(command => [command, context => media(context, command)]),
    ['play', playAudio],
    ['p', playAudio],
    ...['buscar', 'musica', 'letra'].map(command => [command, context => music(context, command)]),
    ...['ia', 'perguntar', 'resumir', 'traduzir'].map(command => [command, context => ai(context, command)]),
  ]);
      }
