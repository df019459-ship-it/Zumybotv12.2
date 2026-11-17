import { randomInt } from 'node:crypto';

export const contentRules = {
  antiimg: ['imageMessage'],
  antivideo: ['videoMessage', 'ptvMessage'],
  antiaudio: ['audioMessage'],
  antisticker: ['stickerMessage'],
  antiloc: ['locationMessage', 'liveLocationMessage'],
  anticontato: ['contactMessage', 'contactsArrayMessage'],
  antidoc: ['documentMessage'],
  anticatalogo: ['productMessage', 'orderMessage'],
  antinotas: ['ptvMessage'],
  antipayment: ['requestPaymentMessage', 'sendPaymentMessage', 'paymentInviteMessage', 'declinePaymentRequestMessage'],
  antienquete: ['pollCreationMessage', 'pollCreationMessageV2', 'pollCreationMessageV3'],
};

const featuredRules = [...Object.keys(contentRules), 'antilinkgp', 'antilinkhard', 'antiflod',
  'limitecaracteres', 'bemvindo', 'bemvindo2', 'autosticker', 'modobrincadeira', 'soadm', 'atodos'];

export const extraAdmin = new Set([
  ...featuredRules, 'apelido', 'legendabv', 'legendasaiu', 'legendabv2', 'legendasaiu2',
  'legendasaiureset', 'legendasaiu2reset', 'nomegp', 'totag', 'hidetag', 'adms',
  'del', 'blockcmdgp', 'unblockcmdgp', 'liberar', 'advertencia', 'advertir', 'advertenciaauto',
  'sorteionumero', 'enquete', 'msgtemp', 'revogar', 'cooldown', 'limitecmd', 'tempocmd',
  'antipalavra', 'addpalavra', 'delpalavra', 'listapalavra',
]);

const normalize = value => value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[-_]/g, '');
const turn = { on: true, off: false, 1: true, 0: false };
const templates = {
  legendabv: 'welcomeText',
  legendabv2: 'welcomeText2',
  legendasaiu: 'goodbyeText',
  legendasaiu2: 'goodbyeText2',
};
const themes = {
  roça: ['Festa junina', 'Churrasco'],
  amor: ['Encontro no cinema', 'Encontro ao ar livre'],
  humor: ['Memes', 'Figurinhas'],
  brasil: ['Praia', 'Cachoeira'],
  nostalgia: ['Filmes antigos', 'Desenhos antigos'],
  comida: ['Pizza', 'Hambúrguer'],
  viagem: ['Montanha', 'Litoral'],
  comportamento: ['Planejar tudo', 'Improvisar'],
};

function commandName(input) {
  return normalize(input.replace(/^!/, ''));
}

export function createGroupSettings({ config, integrations, known, logger }) {
  const toggle = (name, key = name) => ({ arg, settings, update, reply }) => {
    const input = arg.toLowerCase();
    if (!input || input === 'status') return reply('!' + name + ' ' + (settings[key] ? '1' : '0'));
    if (!Object.hasOwn(turn, input)) return reply('Use !' + name + ' 1 para ativar ou 0 para desativar.');
    update({ [key]: turn[input] });
    return reply('!' + name + ' ' + (turn[input] ? 'ativado.' : 'desativado.'));
  };

  async function warn({ settings, target, update, reply, sock, jid }, reason) {
    if (!target) return reply('Marque ou responda à mensagem de um participante.');
    const now = Date.now();
    const warnings = Object.fromEntries(Object.entries(settings.warnings || {}).filter(([, value]) => value.until > now));
    const current = warnings[target] || { count: 0, until: now + 86400000 };
    current.count++;
    warnings[target] = current;
    update({ warnings });
    if (current.count === 3 && settings.advertenciaauto) {
      const result = await sock.groupParticipantsUpdate(jid, [target], 'remove');
      if (Number(result?.[0]?.status) === 200) return reply('3 avisos em 24 horas. Participante removido.');
      return reply('3 avisos em 24 horas. O WhatsApp não confirmou a remoção.');
    }
    return reply('Aviso ' + current.count + '/3 em 24 horas' + (reason ? ' · ' + reason : '') + '.');
  }

  function setList(field, enabled) {
    return ({ arg, update, settings, reply }) => {
      const cmd = commandName(arg);
      if (!known.has(cmd)) return reply('Informe um comando existente no ZUMY.');
      const list = new Set(settings[field] || []);
      if (enabled) list.add(cmd);
      else list.delete(cmd);
      update({ [field]: [...list] });
      return reply('Configuração atualizada para !' + cmd + '.');
    };
  }

  function cooldown({ arg, settings, update, reply }) {
    if (!arg || arg === 'status') return reply('Intervalo entre comandos: ' + (settings.cooldown || 0) + ' s.');
    const seconds = arg === 'off' ? 0 : Number(arg);
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 120) return reply('Informe de 0 a 120 segundos ou off.');
    update({ cooldown: seconds });
    return reply('Intervalo entre comandos: ' + seconds + ' s.');
  }

  function word(enabled) {
    return ({ arg, settings, update, reply }) => {
      const term = arg.trim().toLowerCase();
      if (!term || term.length > 60) return reply('Informe uma palavra ou frase de até 60 caracteres.');
      const terms = new Set(settings.filteredWords || []);
      if (enabled && terms.size >= 100 && !terms.has(term)) return reply('O limite é de 100 termos.');
      if (enabled) terms.add(term);
      else terms.delete(term);
      update({ filteredWords: [...terms] });
      return reply('Lista de palavras atualizada.');
    };
  }

  const commands = {
    cooldown,
    limitecmd: cooldown,
    tempocmd: cooldown,
    antipalavra: toggle('antipalavra'),
    addpalavra: word(true),
    delpalavra: word(false),
    listapalavra: ({ settings, reply }) => reply((settings.filteredWords || []).join('\n') || 'A lista está vazia.'),
    ...Object.fromEntries(featuredRules.map(name => [name, toggle(name)])),
    antilinkgp: toggle('antilinkgp', 'antilink'),
    antiflod: toggle('antiflod', 'antispam'),
    modobrincadeira: toggle('modobrincadeira', 'zoeira'),
    advertenciaauto: toggle('advertenciaauto'),
    limitecaracteres: ({ arg, settings, update, reply }) => {
      if (!arg || arg === 'status') return reply('Limite atual: ' + (settings.maxChars || 'desativado'));
      const value = Number(arg);
      if (!Number.isInteger(value) || (value !== 0 && value !== 1 && (value < 10 || value > 5000))) {
        return reply('Use !limitecaracteres 1 para limitar a 500, 0 para desligar ou defina de 10 a 5000.');
      }
      update({ maxChars: value === 1 ? 500 : value });
      return reply(value ? 'Limite atualizado.' : 'Limite desativado.');
    },
    apelido: ({ arg, settings, update, reply }) => {
      if (!arg) return reply('Apelido neste grupo: ' + (settings.nickname || 'ZUMY'));
      if (arg.length > 32) return reply('Use um apelido de até 32 caracteres.');
      update({ nickname: arg.toLowerCase() === 'reset' ? '' : arg });
      return reply('Apelido atualizado.');
    },
    ...Object.fromEntries(Object.entries(templates).map(([cmd, key]) => [cmd, ({ arg, update, reply }) => {
      if (!arg || arg.length > 500) return reply('Informe uma legenda de até 500 caracteres. Use {usuario} para mencionar.');
      update({ [key]: arg });
      return reply('Legenda salva.');
    }])),
    legendasaiureset: ({ update, reply }) => { update({ goodbyeText: '' }); return reply('Legenda de saída restaurada.'); },
    legendasaiu2reset: ({ update, reply }) => { update({ goodbyeText2: '' }); return reply('Legenda de saída restaurada.'); },
    nomegp: async ({ arg, sock, jid, reply }) => {
      if (!arg || arg.length > 100) return reply('Use !nomegp NOVO NOME com até 100 caracteres.');
      await sock.groupUpdateSubject(jid, arg);
      return reply('Nome atualizado.');
    },
    admins: ({ admins, mention, reply }) => admins.length ? mention('🛡️ Administradores:\n', admins, true) : reply('Nenhum administrador identificado.'),
    adms: ({ admins, mention, reply }) => admins.length ? mention('🚨 Administradores, atenção:\n', admins) : reply('Nenhum administrador identificado.'),
    totag: async ({ arg, members, reply, send, sock, jid, quotedKey, quotedText, commandKey, botAdmin, themeMark }) => {
      const texto = arg || quotedText;
      if (!texto) return reply('Use !totag Atenção, pessoal! ou responda ao aviso com !totag.');
      if (botAdmin === false && [quotedKey, commandKey].some(key => key && !key.fromMe)) {
        return reply('O ZUMY precisa ser admin para apagar a mensagem. Exemplo: responda ao aviso com !totag.');
      }
      await themeMark('totag', members, texto, message => send(message, { citar: false }));
      const keys = new Map([quotedKey, commandKey].filter(key => key?.id).map(key => [key.id, key]));
      const results = await Promise.allSettled([...keys.values()].map(key =>
        Promise.resolve().then(() => sock.sendMessage(jid, { delete: key }))));
      if (results.some(result => result.status === 'rejected')) {
        return send({ text: 'O aviso foi enviado, mas o WhatsApp recusou apagar uma das mensagens.' }, { citar: false });
      }
    },
    hidetag: ({ arg, members, reply, send }) => arg ? send({ text: arg, mentions: members }) : reply('Use !hidetag SUA MENSAGEM.'),
    del: async ({ sock, jid, quotedKey, reply }) => quotedKey
      ? sock.sendMessage(jid, { delete: quotedKey }) : reply('Responda à mensagem com !del.'),
    blockcmdgp: setList('blockedCommands', true),
    unblockcmdgp: setList('blockedCommands', false),
    liberar: setList('allowedCommands', true),
    revogar: setList('allowedCommands', false),
    listbcmdgp: ({ settings, reply }) => reply((settings.blockedCommands || []).map(cmd => '!' + cmd).join('\n') || 'Sem comandos bloqueados.'),
    liberados: ({ settings, reply }) => reply((settings.allowedCommands || []).map(cmd => '!' + cmd).join('\n') || 'Sem comandos liberados.'),
    advertir: context => warn(context, context.arg),
    advertencia: ({ target, settings, reply }) => {
      if (!target) return reply('Marque alguém para consultar os avisos.');
      const entry = settings.warnings?.[target];
      return reply('Avisos em 24 horas: ' + (entry?.until > Date.now() ? entry.count : 0) + '/3.');
    },
    sorteionumero: ({ arg, reply }) => {
      const max = Number(arg);
      return Number.isInteger(max) && max >= 2 && max <= 1000000
        ? reply('🎲 ' + randomInt(1, max + 1)) : reply('Use !sorteionumero LIMITE, de 2 a 1000000.');
    },
    enquete: ({ arg, reply, send }) => {
      const [name, ...values] = arg.split('|').map(part => part.trim());
      const theme = arg.toLowerCase();
      const choices = values.length ? values : Object.hasOwn(themes, theme) ? themes[theme] : undefined;
      if (!name || !choices || choices.length < 2 || choices.length > 10 || choices.some(value => !value || value.length > 100) ||
        new Set(choices).size !== choices.length || name.length > 200) {
        return reply('Use !enquete Pergunta | Opção 1 | Opção 2 ou !enquete humor.');
      }
      return send({ poll: { name, values: choices, selectableCount: 1 } });
    },
    msgtemp: async ({ arg, sock, jid, reply }) => {
      const periods = { 0: 0, 1: 86400, '24h': 86400, '7d': 604800, '90d': 7776000 };
      if (!Object.hasOwn(periods, arg)) return reply('Use !msgtemp 0, 24h, 7d ou 90d.');
      await sock.sendMessage(jid, { disappearingMessagesInChat: periods[arg] });
      return reply('Mensagens temporárias atualizadas.');
    },
  };

  function mediaReason(settings, content, text) {
    for (const [name, types] of Object.entries(contentRules)) {
      if (settings[name] && types.some(type => content[type])) return name;
    }
    if (settings.antilinkhard && /(?:https?:\/\/|www\.)[^\s]+/i.test(text)) return 'link externo';
    if (settings.antipalavra && (settings.filteredWords || []).some(term => text.toLowerCase().includes(term))) return 'palavra configurada';
    if (settings.maxChars && [...text].length > settings.maxChars) return 'limite de caracteres';
    return '';
  }

  async function greet(sock, { id: jid, action, participants }) {
    if (!jid?.endsWith('@g.us') || !['add', 'remove'].includes(action)) return;
    const settings = config.get(jid);
    if (!settings.bemvindo && !settings.bemvindo2) return;
    for (const participant of participants || []) {
      const id = typeof participant === 'string' ? participant : participant?.id;
      if (!id || id === sock.user?.id || id === sock.user?.lid) continue;
      const second = settings.bemvindo2;
      const label = action === 'add'
        ? (second ? settings.welcomeText2 : settings.welcomeText) || 'Bem-vindo, {usuario}!'
        : (second ? settings.goodbyeText2 : settings.goodbyeText) || '{usuario} saiu do grupo.';
      const tag = '@' + id.split('@')[0].split(':')[0];
      const text = (settings.nickname || 'ZUMY') + ' · ' + label.replaceAll('{usuario}', tag);
      const mentions = label.includes('{usuario}') ? [id] : [];
      if (action === 'add' && settings.welcomeImage) {
        try {
          await sock.sendMessage(jid, { image: Buffer.from(settings.welcomeImage, 'base64'), caption: text, mentions });
          continue;
        } catch (error) { logger.warn({ code: error.code }, 'Falha ao enviar imagem de boas-vindas'); }
      }
      await sock.sendMessage(jid, { text, mentions });
    }
  }

  async function autoSticker(context) {
    if (!context.source.imageMessage) return;
    try {
      await integrations.sticker(context);
    } catch (error) {
      logger.warn({ err: error.message }, 'Falha no autosticker');
    }
  }

  return { commands, mediaReason, greet, autoSticker, warn };
}

const inactivityMs = 2 * 60 * 60 * 1000;
const ranksAtividade = ['ranklevel', 'rankativos', 'rankdia', 'topfood'];
const temas = ['🚀 Missão do grupo', '🎮 Checkpoint da galera', '🎵 Chamada da playlist', '🌟 Radar da Zumy', '☕ Pausa para conversa', '🎉 Rodada de presença'];
const arroba = id => '@' + id.split('@')[0].split(':')[0];
const nivel = n => 1 + Math.floor(Math.sqrt(n / 10));
const patente = n => n >= 10 ? 'Lenda' : n >= 6 ? 'Veterano' : n >= 3 ? 'Explorador' : 'Novato';
const zonas = new Map();
function horario(now, zone) {
  if (!zonas.has(zone)) zonas.set(zone, new Intl.DateTimeFormat('pt-BR', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }));
  const p = Object.fromEntries(zonas.get(zone).formatToParts(now).map(part => [part.type, part.value]));
  return { date: p.day + '/' + p.month + '/' + p.year, time: p.hour + ':' + p.minute, hour: Number(p.hour) };
}

export const communityAdmin = new Set([
  'castigo', 'liberarcastigo', 'limpar', 'sync', 'imagembv', 'listban', 'listanegra',
  'listabranca', 'tirardalista', 'autorepro', 'antiporno', 'autodownload', 'listapalavrao',
]);

export function createCommunity({ config, integrations, env, logger, responderVoz, downloadMedia }) {
  const zone = env.BOT_TIMEZONE || 'America/Fortaleza';
  const save = (jid, patch) => config.save(jid, { ...config.get(jid), ...patch });
  const amount = (entry, key, today) => key === 'rankdia' ? (entry?.date === today ? entry.daily : 0) : entry?.total || 0;
  const stats = jid => config.get(jid).activity || {};
  const botIds = sock => [sock.user?.id, sock.user?.lid].filter(Boolean).map(id => id.replace(/:\d+(?=@)/, ''));
  const list = (data, ids) => ids.filter(id => data[id]);
  const choose = items => items.length ? items[randomInt(items.length)] : undefined;
  const switchValue = value => ['1', 'on'].includes(value) ? true : ['0', 'off'].includes(value) ? false : undefined;

  function observe(jid, actor, name, now = Date.now()) {
    if (!actor) return;
    const a = stats(jid);
    const day = horario(now, zone).date;
    const prev = a[actor];
    const next = { total: (prev?.total || 0) + 1, daily: (prev?.date === day ? prev.daily : 0) + 1,
      date: day, last: now, reminded: false, theme: prev?.theme, name: (name || prev?.name || '').slice(0, 70) };
    const updated = { ...a, [actor]: next };
    const keys = Object.keys(updated);
    if (keys.length > 1500) delete updated[keys.reduce((old, id) => updated[id].last < updated[old].last ? id : old)];
    save(jid, { activity: updated });
  }

  function themeMark(jid, key, ids, intro, send) {
    const old = config.get(jid).themeCursor?.[key] || 0;
    const cursor = old + 1;
    save(jid, { themeCursor: { ...config.get(jid).themeCursor, [key]: cursor } });
    const data = stats(jid);
    const rows = ids.map((id, i) => {
      const name = data[id]?.name ? ' · ' + data[id].name : '';
      return temas[(cursor + i) % temas.length] + ' ' + arroba(id) + name;
    });
    return send({ text: intro + '\n' + rows.join('\n'), mentions: ids });
  }

  async function rank(ctx, key) {
    const data = stats(ctx.jid);
    const now = horario(ctx.now ?? Date.now(), zone).date;
    let candidates = [...ctx.members];
    const orientation = ['rankgay', 'ranklesbica'].includes(key);
    if (orientation) {
      const opt = ctx.settings.rankOpt?.[key] || [];
      if (['participar', 'sair'].includes(ctx.arg.toLowerCase())) {
        const next = new Set(opt);
        if (ctx.arg.toLowerCase() === 'participar') next.add(ctx.actor); else next.delete(ctx.actor);
        ctx.update({ rankOpt: { ...ctx.settings.rankOpt, [key]: [...next] } });
        return ctx.reply(next.has(ctx.actor) ? 'Você entrou voluntariamente neste ranking.' : 'Você saiu deste ranking.');
      }
      candidates = candidates.filter(id => opt.includes(id));
      if (!candidates.length) return ctx.reply('Este ranking é por adesão. Exemplo: !' + key + ' participar. Para sair, use !' + key + ' sair.');
    }
    if (!candidates.length) return ctx.reply('Ainda não há participantes para este ranking.');
    const real = ranksAtividade.includes(key);
    if (!real) {
      for (let i = candidates.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      }
    }
    const rows = candidates.map(id => [id, real ? amount(data[id], key, now) : randomInt(1, 101)])
      .filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (!rows.length) return ctx.reply(ctx.settings.communitySync
      ? 'Ainda não há atividade registrada para este ranking.'
      : 'Sem atividade registrada. Um administrador pode ativar com !sync.');
    const total = candidates.reduce((sum, id) => sum + amount(data[id], key, now), 0);
    const title = ({ ranklevel: '🏅 Níveis e patentes', rankativos: '🔥 Mais ativos', rankdia: '📅 Ranking do dia',
      topfood: '📈 Top atividade', rankgay: '🌈 Ranking voluntário gay', ranklesbica: '🌈 Ranking voluntário lésbico',
      rankmentiroso: '🎭 Ranking dos contadores de histórias' })[key] || '🎲 ' + key + ' · brincadeira';
    const lines = rows.map(([id, n], i) => {
      const pct = real ? Math.round(n * 100 / total) : n;
      return (i + 1) + '. ' + arroba(id) + ' · ' + pct + '%' +
        (real ? ' · ' + n + ' interações · Nível ' + nivel(data[id]?.total || 0) + ' · ' + patente(nivel(data[id]?.total || 0)) : '');
    });
    const caption = title + '\n' + lines.join('\n');
    try {
      const score = real ? Math.round(rows[0][1] * 100 / total) : rows[0][1];
      const image = await integrations.rankCard(key, title, score);
      return await ctx.send({ image, caption, mentions: rows.map(([id]) => id) });
    } catch (error) {
      logger.warn({ code: error.code }, 'Falha ao gerar a imagem do ranking');
      return ctx.send({ text: caption, mentions: rows.map(([id]) => id) });
    }
  }

  function activity(ctx, inactive) {
    const now = Date.now();
    const data = stats(ctx.jid);
    const ids = list(data, ctx.members).filter(id => (now - data[id].last >= inactivityMs) === inactive).slice(0, 20);
    return ids.length ? themeMark(ctx.jid, inactive ? 'inativos' : 'ativos', ids,
      inactive ? '❌ Sem interação há 2 horas ou mais' : '✅ Interagiram nas últimas 2 horas', ctx.send)
      : ctx.reply('Nenhum participante registrado nessa faixa. Acompanhe novas mensagens após !sync.');
  }

  async function perfil(ctx, role) {
    const id = ctx.target || ctx.actor;
    if (!id || (role === 'espiar' && !ctx.target)) return ctx.reply('Exemplo: !espiar @participante.');
    const data = stats(ctx.jid)[id];
    const level = nivel(data?.total || 0);
    const text = '👤 ' + (data?.name || arroba(id)) + '\n🏅 Nível ' + level + ' · ' + patente(level) +
      '\n💬 Interações: ' + (data?.total || 0) + (ctx.arg === '2' || role === 'espiar'
      ? '\n🕐 Última atividade: ' + (data?.last ? horario(data.last, zone).date + ' às ' + horario(data.last, zone).time : 'sem registro') : '');
    try {
      const image = await ctx.sock.profilePictureUrl(id, 'image', 4000);
      if (image) return await ctx.send({ image: { url: image }, caption: text, mentions: [id] });
    } catch { /* A foto pode estar privada. */ }
    return ctx.send({ text, mentions: [id] });
  }

  async function clima(ctx, kind) {
    if (!ctx.arg || ctx.arg.length > 100) return ctx.reply('Use !' + kind + ' CIDADE. Exemplo: !' + kind + ' Fortaleza.');
    const query = new URLSearchParams({ name: ctx.arg, count: '1', language: 'pt', format: 'json' });
    try {
      const geo = await fetch('https://geocoding-api.open-meteo.com/v1/search?' + query, { signal: AbortSignal.timeout(8000) });
      if (!geo.ok) throw Error('geocoding');
      const [city] = (await geo.json()).results || [];
      if (!city) return ctx.reply('Cidade não encontrada. Tente o nome por extenso.');
      const params = new URLSearchParams({ latitude: city.latitude, longitude: city.longitude, timezone: 'auto',
        current: 'temperature_2m,apparent_temperature,precipitation', hourly: 'precipitation_probability', forecast_days: '1' });
      const weather = await fetch('https://api.open-meteo.com/v1/forecast?' + params, { signal: AbortSignal.timeout(8000) });
      if (!weather.ok) throw Error('weather');
      const data = await weather.json();
      const future = (data.hourly?.time || []).findIndex(t => t >= data.current?.time);
      const chance = data.hourly?.precipitation_probability?.[future];
      const temperature = '🌡️ ' + data.current.temperature_2m + ' °C · sensação ' + data.current.apparent_temperature + ' °C';
      const rain = '🌧️ Precipitação atual: ' + data.current.precipitation + ' mm' + (Number.isFinite(chance) ? ' · próxima hora ' + chance + '%' : '');
      return ctx.reply('📍 ' + [city.name, city.admin1].filter(Boolean).join(', ') + '\n' +
        (kind === 'calor' ? temperature : kind === 'chuva' ? rain : temperature + '\n' + rain) + '\nFonte: Open-Meteo');
    } catch { return ctx.reply('A previsão está indisponível agora. Tente outra vez.'); }
  }

  const pending = jid => (config.get(jid).requests || []).filter(item => item.expires > Date.now());
  async function relacionamento(ctx, action) {
    const { actor, target, jid, send, reply, update } = ctx;
    if (!actor) return reply('Não consegui identificar sua conta.');
    const current = pending(jid);
    const couples = config.get(jid).couples || {};
    const options = { amizade: 'amizade', pegar: 'ficar', namorar: 'namoro' };
    if (Object.hasOwn(options, action)) {
      if (!target || target === actor || !ctx.members.includes(target)) return reply('Use !' + action + ' @participante. Marque outra pessoa do grupo.');
      if ((action === 'namorar' && (couples[actor] || couples[target])) || current.some(x => [x.from, x.to].some(id => id === actor || id === target))) {
        return reply('Já há um relacionamento ou pedido pendente para uma das pessoas.');
      }
      update({ requests: [...current, { from: actor, to: target, type: action, expires: Date.now() + 300000 }] });
      return send({ text: '💌 ' + arroba(actor) + ' fez um pedido de ' + options[action] + ' para ' + arroba(target) +
        '. Responda em 5 minutos com !aceitar ' + action + ' S ou !aceitar ' + action + ' N.', mentions: [actor, target] });
    }
    if (action === 'terminanamoro') {
      if (!/^t$/i.test(ctx.arg)) return reply('Para terminar o namoro de brincadeira, envie !terminanamoro T.');
      const partner = couples[actor];
      if (!partner) return reply('Não há namoro cadastrado para sua conta neste grupo.');
      const next = { ...couples };
      delete next[actor]; delete next[partner];
      update({ couples: next });
      return reply('Namoro de brincadeira encerrado.');
    }
    if (action === 'cancelarpedido') {
      const item = current.find(x => x.from === actor && (!target || x.to === target));
      if (!item) return reply('Não encontrei um pedido seu em aberto. Exemplo: !cancelarpedido @participante.');
      update({ requests: current.filter(x => x !== item) });
      return reply('Pedido cancelado.');
    }
    const answer = /^(namorar|amizade|pegar)\s+([sn])$/i.exec(ctx.arg);
    if (!answer) return reply('Exemplo: !aceitar namorar S. Use N para recusar.');
    const item = current.find(x => x.to === actor && x.type === answer[1].toLowerCase());
    if (!item) return reply('Você não tem um pedido ativo desse tipo.');
    const aceitar = answer[2].toLowerCase() === 's';
    if (aceitar && item.type === 'namorar' && (couples[item.from] || couples[item.to])) {
      update({ requests: current.filter(x => x !== item) });
      return reply('Uma das contas já está em um namoro de brincadeira.');
    }
    const pair = aceitar && item.type === 'namorar' ? { ...couples, [item.from]: item.to, [item.to]: item.from } : couples;
    update({ requests: current.filter(x => x !== item), couples: pair });
    return reply(aceitar ? '💖 Pedido aceito!' : 'Pedido recusado.');
  }

  const commands = {
    sync: async ctx => {
      const enabled = !ctx.arg || switchValue(ctx.arg);
      if (enabled === undefined) return ctx.reply('Use !sync para ativar ou !sync 0 para desativar os automáticos.');
      const accumulated = { ...stats(ctx.jid) };
      if (enabled) {
        const now = Date.now(), date = horario(now, zone).date;
        for (const id of ctx.members.slice(0, 1500)) {
          accumulated[id] ??= { total: 0, daily: 0, date, last: now, reminded: false,
            name: (ctx.meta.participants.find(p => p.id === id)?.name || '').slice(0, 70) };
        }
      }
      ctx.update({ communitySync: enabled, activity: accumulated });
      return ctx.reply(enabled ? 'Sincronizado: níveis, ranking diário, saudações e lembretes ativos neste grupo.' : 'Automáticos de atividade desativados neste grupo.');
    },
    castigo: ctx => {
      const duration = /(?:^|\s)(\d{1,3})(m|h|d)(?=\s|@|$)/i.exec(ctx.arg);
      const ms = Number(duration?.[1]) * ({ m:60000, h:3600000, d:86400000 })[duration?.[2]?.toLowerCase()];
      if (!ctx.target || !ms || ms > 7 * 86400000) return ctx.reply('Use !castigo 24h @participante. Limite: 7 dias.');
      if (ctx.botAdmin === false) return ctx.reply('O bot precisa ser administrador para aplicar castigo.');
      if (ctx.admins.includes(ctx.target) || ctx.target === ctx.actor || botIds(ctx.sock).includes(ctx.target)) return ctx.reply('Escolha um participante comum do grupo.');
      ctx.update({ castigos: { ...ctx.settings.castigos, [ctx.target]: Date.now() + ms } });
      return ctx.reply('Castigo aplicado. O ZUMY vai apagar as novas mensagens dessa pessoa durante o prazo.');
    },
    liberarcastigo: ctx => {
      if (!ctx.target) return ctx.reply('Use !liberarcastigo @participante.');
      const rest = { ...ctx.settings.castigos };
      delete rest[ctx.target];
      ctx.update({ castigos: rest });
      return ctx.reply('Castigo removido.');
    },
    limpar: ctx => ctx.quotedKey ? ctx.sock.sendMessage(ctx.jid, { delete: ctx.quotedKey })
      : ctx.reply('Responda à mensagem que deseja apagar com !limpar.'),
    imagembv: async ctx => {
      if (/^(0|reset)$/i.test(ctx.arg)) {
        ctx.update({ welcomeImage: '' });
        return ctx.reply('Imagem de boas-vindas removida.');
      }
      if (!ctx.source.imageMessage) return ctx.reply('Responda a uma foto com !imagembv. Para remover, use !imagembv reset.');
      try {
        if (Number(ctx.source.imageMessage.fileLength) > 1024 * 1024) return ctx.reply('O limite é 1 MB.');
        const image = await ctx.download(downloadMedia);
        if (!image?.length || image.length > 1024 * 1024) return ctx.reply('Use uma foto de até 1 MB.');
        ctx.update({ welcomeImage: image.toString('base64') });
        return ctx.reply('Imagem salva. Ative a legenda com !bemvindo 1 ou !bemvindo2 1.');
      } catch { return ctx.reply('Não consegui baixar a foto. Envie a foto novamente e responda a ela com !imagembv.'); }
    },
    listban: ctx => {
      const history = ctx.settings.banHistory || [];
      const ids = ctx.settings.banList || [];
      if (!history.length && !ids.length) return ctx.reply('Sem banimentos registrados ou contas bloqueadas. Exemplo: !listanegra @participante.');
      const recent = history.slice(-10).reverse().map(item => arroba(item.id) + ' · ' + horario(item.at, zone).date);
      const text = [
        recent.length ? '⛔ Últimos banimentos pelo bot\n' + recent.join('\n') : '',
        ids.length ? '🚫 Lista de bloqueio\n' + ids.slice(0, 20).map(arroba).join('\n') : '',
      ].filter(Boolean).join('\n\n');
      return ctx.send({ text, mentions: [...new Set([...history.slice(-10).map(item => item.id), ...ids.slice(0, 20)])] });
    },
    listanegra: ctx => {
      if (!ctx.target) return commands.listban(ctx);
      if (ctx.admins.includes(ctx.target) || ctx.target === ctx.actor || botIds(ctx.sock).includes(ctx.target)) return ctx.reply('Escolha um participante comum.');
      const ids = new Set(ctx.settings.banList || []);
      if (ids.size >= 100 && !ids.has(ctx.target)) return ctx.reply('A lista atingiu 100 contas.');
      ids.add(ctx.target);
      ctx.update({ banList:[...ids], allowList:(ctx.settings.allowList || []).filter(id => id !== ctx.target) });
      return ctx.reply('Conta colocada na lista de bloqueio. O bot bloqueia a próxima entrada se puder remover participantes.');
    },
    listabranca: ctx => {
      const ids = new Set(ctx.settings.allowList || []);
      if (!ctx.target) return ids.size ? themeMark(ctx.jid, 'lista-branca', [...ids].slice(0,20), '✅ Lista branca', ctx.send)
        : ctx.reply('Lista branca vazia. Use !listabranca @participante.');
      if (ids.size >= 100 && !ids.has(ctx.target)) return ctx.reply('A lista atingiu 100 contas.');
      ids.add(ctx.target);
      ctx.update({ allowList:[...ids], banList:(ctx.settings.banList || []).filter(id => id !== ctx.target) });
      return ctx.reply('Conta liberada na lista branca.');
    },
    tirardalista: ctx => {
      if (!ctx.target) return ctx.reply('Use !tirardalista @participante.');
      ctx.update({ banList:(ctx.settings.banList || []).filter(id => id !== ctx.target), allowList:(ctx.settings.allowList || []).filter(id => id !== ctx.target) });
      return ctx.reply('Conta retirada das listas.');
    },
    banfake: ctx => ctx.target ? ctx.send({ text:'🎭 Banimento de brincadeira: ' + arroba(ctx.target) + '. A pessoa continua no grupo.', mentions:[ctx.target] }) : ctx.reply('Use !banfake @participante.'),
    listapalavrao: ctx => ctx.reply('Palavras cadastradas em !addpalavra:\n' + ((ctx.settings.filteredWords || []).join('\n') || 'Nenhuma.')),
    espiar: ctx => perfil(ctx, 'espiar'),
    perfil: ctx => perfil(ctx, 'perfil'),
    aura: ctx => ctx.reply('✨ Sua aura de brincadeira hoje: ' + randomInt(101) + '% · ' + choose(temas)),
    confessar: ctx => !ctx.arg ? ctx.reply('Use !confessar SUA MENSAGEM. A mensagem é pública.')
      : ctx.reply('💭 Confissão: ' + ctx.arg.slice(0, 500)),
    checkativos: ctx => activity(ctx, false),
    atividades: ctx => activity(ctx, false),
    inativos: ctx => activity(ctx, true),
    'previsaodotempo': ctx => clima(ctx, 'previsaodotempo'),
    calor: ctx => clima(ctx, 'calor'),
    chuva: ctx => clima(ctx, 'chuva'),
    dataehora: ctx => {
      const h = horario(Date.now(), zone); return ctx.reply('📅 ' + h.date + ' · ⌚ ' + h.time);
    },
    signo: ctx => {
      const signs = ['aries','touro','gemeos','cancer','leao','virgem','libra','escorpiao','sagitario','capricornio','aquario','peixes'];
      const name = normalize(ctx.arg);
      if (!signs.includes(name)) return ctx.reply('Digite o nome do signo. Exemplo: !signo Leão.');
      return ctx.reply('🔮 ' + ctx.arg + ' · Horóscopo de brincadeira: ' + choose([
        'Puxe conversa com alguém que você não vê há um tempo.', 'Hoje combina com boa música e uma pausa para descansar.',
        'Uma novidade pode render boas risadas no grupo.', 'Reserve um tempo para o que te dá energia.',
      ]));
    },
    curriculo: ctx => {
      const id = ctx.target || ctx.actor;
      if (!id) return ctx.reply('Use !currículo @participante.');
      return ctx.send({ text:'💌 Currículo do Amor · ' + arroba(id) + '\n🎯 Objetivo: boas conversas e risadas.\n🎵 Habilidade sorteada: ' +
        choose(['montar playlists','lembrar datas','mandar memes','puxar assunto']) + '\n💖 Afinidade de brincadeira: ' + randomInt(101) + '%.', mentions:[id] });
    },
  };
  for (const cmd of ['amizade','pegar','namorar','aceitar','cancelarpedido','terminanamoro']) commands[cmd] = ctx => relacionamento(ctx, cmd);
  for (const cmd of ['dogolpe','golpe']) commands[cmd] = ctx => {
    const id = ctx.target || ctx.actor;
    return id ? ctx.send({ text:'🎭 Radar fictício do golpe: ' + arroba(id) + ' · ' + randomInt(101) + '% de zoeira.', mentions:[id] })
      : ctx.reply('Exemplo: !golpe @participante.');
  };
  for (const name of ['autorepro','antiporno','autodownload']) commands[name] = ctx => {
    if (!ctx.arg || ctx.arg === 'status') return ctx.reply('!' + name + ' ' + (ctx.settings[name] ? '1' : '0') + '. Exemplo: !' + name + ' 1.');
    const on = switchValue(ctx.arg);
    if (on === undefined) return ctx.reply('Use !' + name + ' 1 ou !' + name + ' 0.');
    ctx.update({ [name]:on });
    return ctx.reply('!' + name + ' ' + (on ? 'ativado.' : 'desativado.') +
      (name === 'antiporno' && on ? ' Filtro local por palavras em textos e legendas. Use !addpalavra para cadastrar termos.' : ''));
  };
  for (const cmd of [...ranksAtividade,'rankgay','ranklesbica','rankmentiroso']) commands[cmd] = ctx => rank(ctx, cmd);

  async function restricted({ sock, msg, jid, actor, text, isAdmin, botAdmin, settings }) {
    if (!actor || isAdmin || msg.key.fromMe || botAdmin === false) return false;
    const castigado = (settings.castigos?.[actor] || 0) > Date.now();
    const normalized = normalize(text || '');
    const terms = ['pornografia', 'video porno', 'conteudo adulto', ...(settings.filteredWords || [])];
    const classified = settings.antiporno && !(settings.allowList || []).includes(actor) &&
      terms.some(term => normalized.includes(normalize(term)));
    if (!castigado && !classified) return false;
    try {
      await sock.sendMessage(jid, { delete: msg.key });
      return true;
    } catch (error) {
      logger.warn({ code: error.code }, 'WhatsApp recusou apagar conteúdo');
      return false;
    }
  }

  async function entrance(sock, event, greet) {
    const { id: jid, action, participants = [] } = event;
    if (action === 'remove') {
      const settings = config.get(jid);
      const ids = new Set(participants.map(p => typeof p === 'string' ? p : p.id));
      const couples = Object.fromEntries(Object.entries(settings.couples || {}).filter(([a,b]) => !ids.has(a) && !ids.has(b)));
      const requests = (settings.requests || []).filter(r => !ids.has(r.from) && !ids.has(r.to));
      if (Object.keys(settings.couples || {}).length !== Object.keys(couples).length ||
          (settings.requests || []).length !== requests.length) save(jid, { couples, requests });
      return greet(sock, event);
    }
    if (action !== 'add') return greet(sock, event);
    const settings = config.get(jid);
    const allowed = [];
    const first = { ...stats(jid) };
    const now = Date.now();
    let changed = false;
    for (const p of participants) {
      const id = typeof p === 'string' ? p : p.id;
      if (!id || botIds(sock).includes(id)) continue;
      const identifiers = typeof p === 'string' ? [p] : [id, p.lid, p.phoneNumber].filter(Boolean);
      if (identifiers.some(value => (settings.banList || []).includes(value)) &&
          !identifiers.some(value => (settings.allowList || []).includes(value))) {
        try {
          const result = await sock.groupParticipantsUpdate(jid, [id], 'remove');
          if (Number(result?.[0]?.status) === 200) continue;
        } catch (error) { logger.warn({ code: error.code }, 'Falha na lista de bloqueio'); }
      }
      allowed.push(p);
      if (settings.communitySync && (first[id] || Object.keys(first).length < 1500)) {
        first[id] = { total: first[id]?.total || 0, daily: first[id]?.daily || 0,
          date: first[id]?.date || horario(now, zone).date, last: now, reminded: false, name: first[id]?.name || '' };
        changed = true;
      }
    }
    if (changed) save(jid, { activity: first });
    return greet(sock, { ...event, participants: allowed });
  }

  async function tick(sock, at = Date.now()) {
    const h = horario(at, zone);
    for (const jid of config.ids()) {
      const settings = config.get(jid);
      if (!settings.communitySync) continue;
      try {
        const slots = settings.communitySlots || {};
        const activity = stats(jid);
        const waiting = Object.entries(activity).filter(([, x]) => !x.reminded && at - x.last >= inactivityMs);
        const greeting = ({ 6:'Bom dia', 12:'Boa tarde', 18:'Boa noite' })[h.hour];
        const greetNow = greeting && slots.greeting !== h.date + ':' + h.hour;
        const rankNow = h.hour === 20 && slots.rank !== h.date;
        if (!waiting.length && !greetNow && !rankNow) continue;
        const meta = await sock.groupMetadata(jid);
        const members = meta.participants.map(p => p.id).filter(id => id && !botIds(sock).includes(id));
        const send = message => sock.sendMessage(jid, message);
        const update = patch => save(jid, patch);
        if (greetNow) {
          const greetingText = greeting + '! Sou a Zumy. Agora são ' + h.time + '. Hoje é ' + h.date + '.';
          await send({ text: '🎙️ ' + greeting + '! Sou a Zumy.\n⌚ ' + h.time + ' · 📅 ' + h.date });
          const nowSettings = config.get(jid);
          responderVoz.narrar({ jid, settings: { ...nowSettings, voiceStyle: 'anime' }, update, send }, greetingText);
          update({ communitySlots: { ...config.get(jid).communitySlots, greeting: h.date + ':' + h.hour } });
        }
        if (rankNow) {
          await rank({ jid, members, settings: config.get(jid), send, reply: text => send({ text }), update, arg: '', now: at }, 'rankdia');
          update({ communitySlots: { ...config.get(jid).communitySlots, rank: h.date } });
        }
        const atual = stats(jid);
        const reminders = waiting.filter(([id, entry]) => members.includes(id) && atual[id]?.last === entry.last && !atual[id]?.reminded).slice(0, 5);
        if (reminders.length) {
          const rotations = new Map(reminders.map(([id, entry], index) =>
            [id, entry.theme === undefined ? index % temas.length : (entry.theme + 1) % temas.length]));
          const lines = reminders.map(([id, entry]) => temas[rotations.get(id)] + ' ' + arroba(id) +
            (entry.name ? ' · ' + entry.name : '') + ', faz duas horas que você não aparece.');
          await send({ text: '👋 Lembretes do grupo\n' + lines.join('\n'), mentions: reminders.map(([id]) => id) });
          const latest = { ...stats(jid) };
          for (const [id, entry] of reminders) {
            if (latest[id]?.last === entry.last) latest[id] = { ...entry, reminded: true, theme: rotations.get(id) };
          }
          update({ activity: latest });
        }
        const departed = waiting.filter(([id]) => !members.includes(id));
        if (departed.length) {
          const latest = { ...stats(jid) };
          for (const [id, entry] of departed) if (latest[id]?.last === entry.last) latest[id] = { ...entry, reminded: true };
          update({ activity: latest });
        }
      } catch (error) { logger.warn({ code: error.code, name: error.name }, 'Falha nos automáticos do grupo'); }
    }
  }

  return { commands, observe, restricted, entrance, tick, rank, themeMark };
}
