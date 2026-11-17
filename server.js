import express from 'express';
import pino from 'pino';
import QRCode from 'qrcode';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, downloadMediaMessage } from '@whiskeysockets/baileys';
import { createGroupHandler, identidadePrivada } from './grupos.js';
import { ownerName, ownerNumber, prefix } from './menu.js';
import { chamouZumy } from './voz.js';

const app=express();app.use(express.json({ limit: '16kb' }));
const port=Number(process.env.PORT||3000);
const folder=process.env.SESSION_DIR||'./session';mkdirSync(folder,{recursive:true});
const ownerPath = join(folder, 'zumy-dono.json');
const defaultOwner = {
  name: process.env.OWNER_NAME || ownerName,
  number: String(process.env.OWNER_NUMBER || ownerNumber).replace(/\D/g, ''),
  lid: process.env.OWNER_LID || '',
};
function validateOwner(value) {
  if (typeof value?.name !== 'string' || typeof value.number !== 'string' ||
      (value.lid !== undefined && typeof value.lid !== 'string')) return;
  const owner = {
    name: value.name.replace(/[\r\n*]/g, ' ').trim(),
    number: value.number.trim().replace(/[+ .()-]/g, ''),
    lid: (value.lid || '').trim(),
  };
  if (owner.name.length < 1 || owner.name.length > 60 || !/^\d{10,15}$/.test(owner.number) ||
      (owner.lid && !/^\d+@lid$/.test(owner.lid))) return;
  return owner;
}
let ownerSaved;
try {
  ownerSaved = validateOwner(JSON.parse(readFileSync(ownerPath, 'utf8')));
  if (!ownerSaved) throw new Error('O cadastro do dono salvo no disco é inválido.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const authPointer = join(folder, 'zumy-auth-active');
function activeAuthFolder() {
  try {
    const name = readFileSync(authPointer, 'utf8').trim();
    if (!/^whatsapp-[a-zA-Z0-9]{6}$/.test(name)) throw new Error('Pasta de sessão inválida.');
    return join(folder, name);
  } catch (error) {
    if (error.code === 'ENOENT') return folder;
    throw error;
  }
}
function prepareNewAuthFolder() {
  const path = mkdtempSync(join(folder, 'whatsapp-'));
  const name = path.slice(path.lastIndexOf('/') + 1);
  writeFileSync(authPointer + '.tmp', name, { mode: 0o600 });
  renameSync(authPointer + '.tmp', authPointer);
}
const adminToken=process.env.ADMIN_TOKEN;
let status='iniciando',sock=null,qr=null,attempt=0,paused=false;
let reconnectTimer;
let pairingInProgress = false;
const logger=pino({level:process.env.LOG_LEVEL||'info'});
const handleGroup = createGroupHandler({
  folder,
  logger,
  env: process.env,
  getOwner: () => ownerSaved,
  downloadMedia: msg => downloadMediaMessage(msg, 'buffer', {}),
  restart: () => process.exit(1),
});
const protect=(req,res,next)=>{if(!adminToken)return res.status(503).json({error:'Configure ADMIN_TOKEN em Environment no Render'});if(req.get('authorization')!==`Bearer ${adminToken}`)return res.status(401).json({error:'Token incorreto. Use o ADMIN_TOKEN do serviço ZUMYBOT-3.0.'});next()};
app.get('/',(_req,res)=>res.type('html').send(`<html lang="pt-br"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ZUMY</title><body style="font:18px system-ui;background:#101a28;color:white;padding:24px"><h1>🤖 ZUMY</h1><p>Status público: <b>${status}</b></p><p>Use /health para conferir a conexão. <a href="/parear" style="color:#8af0bb">Abrir painel de autenticação e configuração</a>.</p></body></html>`));
app.get('/parear', (_req, res) => {
  const nonce = randomBytes(18).toString('base64');
  res.set({
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; script-src 'nonce-" + nonce +
      "'; style-src 'nonce-" + nonce + "'; connect-src 'self'; img-src data:; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
    'Referrer-Policy': 'no-referrer',
  });
  res.type('html').send(`<!doctype html>
<html lang="pt-BR">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Parear ZUMY</title>
<style nonce="${nonce}">
  * { box-sizing: border-box; }
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; padding: 24px; background: #101a28; color: #fff; }
  main { max-width: 32rem; margin: 4vh auto; }
  label, input, button, select, textarea { display: block; width: 100%; }
  input, button, select, textarea { margin: 6px 0 16px; padding: 12px; border-radius: 8px; font: inherit; }
  input, select, textarea { border: 1px solid #91a8be; }
  button { background: #8af0bb; color: #10241d; border: 0; font-weight: 650; }
  button:disabled { opacity: .65; }
  section { border-top: 1px solid #38516b; margin-top: 20px; padding-top: 12px; }
  a { color: #a0deff; }
  #qr { display: block; width: min(100%, 300px); margin: 16px auto; }
  #qr[hidden] { display: none; }
  #code { font: bold 1.5rem ui-monospace, monospace; letter-spacing: .15em; overflow-wrap: anywhere; }
</style>
<main>
  <h1>Painel do ZUMY</h1>
  <p>Use o token de administração para vincular o WhatsApp, cadastrar o dono e sincronizar os grupos.</p>
  <form id="pair" autocomplete="off">
    <label for="number">Número do bot com código do país</label>
    <input id="number" type="tel" inputmode="tel" placeholder="55 + DDD + número" required maxlength="25">
    <label for="token">Token de administração do Render (ADMIN_TOKEN)</label>
    <input id="token" type="password" required autocomplete="off">
    <button type="submit">Gerar código</button>
    <button type="button" id="show-qr">Mostrar QR Code</button>
    <button type="button" id="reset">Preparar nova sessão</button>
  </form>
  <p id="result" role="status"></p>
  <p id="code"></p>
  <img id="qr" alt="QR Code de pareamento" hidden>
  <p>No WhatsApp do bot, abra <strong>Aparelhos conectados → Conectar um aparelho → Conectar com número de telefone</strong>.</p>
  <a href="/health">Ver status do bot</a>
  <section>
    <h2>Dono do bot</h2>
    <button type="button" id="settings-load">Carregar cadastro</button>
    <form id="owner" autocomplete="off">
      <label for="owner-name">Nome do responsável</label>
      <input id="owner-name" required maxlength="60">
      <label for="owner-number">Número do dono com DDI e DDD</label>
      <input id="owner-number" type="tel" required maxlength="25">
      <label for="owner-lid">LID do dono, se disponível pelo !meuid</label>
      <input id="owner-lid" placeholder="Opcional" maxlength="40">
      <button>Salvar dono</button>
    </form>
    <p id="owner-result" role="status"></p>
  </section>
  <section>
    <h2>Configuração dos grupos</h2>
    <button type="button" id="settings-groups">Sincronizar grupos</button>
    <form id="group">
      <label for="group-id">Grupo do WhatsApp</label>
      <select id="group-id" required><option value="">Sincronize para selecionar</option></select>
      <fieldset id="group-fields" disabled>
        <legend>Configuração do grupo selecionado</legend>
        <label for="group-name">Apelido da Zumy</label>
        <input id="group-name" maxlength="32">
        <label for="group-greet">Modo de boas-vindas e saída</label>
        <select id="group-greet"><option value="off">Desligado</option><option value="one">Legenda 1</option><option value="two">Legenda 2</option></select>
        <label for="group-welcome">Boas-vindas 1</label>
        <textarea id="group-welcome" maxlength="500" placeholder="Bem-vindo, {usuario}!"></textarea>
        <label for="group-goodbye">Saída 1</label>
        <textarea id="group-goodbye" maxlength="500" placeholder="Até logo, {usuario}!"></textarea>
        <label for="group-welcome2">Boas-vindas 2</label>
        <textarea id="group-welcome2" maxlength="500"></textarea>
        <label for="group-goodbye2">Saída 2</label>
        <textarea id="group-goodbye2" maxlength="500"></textarea>
        <button>Salvar grupo</button>
      </fieldset>
    </form>
    <p id="group-result" role="status"></p>
  </section>
</main>
<script nonce="${nonce}">
  const form = document.getElementById('pair');
  const token = document.getElementById('token');
  const number = document.getElementById('number');
  const result = document.getElementById('result');
  const code = document.getElementById('code');
  const qrImage = document.getElementById('qr');
  const buttons = Array.from(form.querySelectorAll('button'));
  async function pair(action) {
    if (buttons[0].disabled) return;
    if (!token.value.trim()) {
      result.textContent = 'Informe o ADMIN_TOKEN do Render.';
      token.focus();
      return;
    }
    buttons.forEach(button => button.disabled = true);
    qrImage.hidden = true;
    qrImage.removeAttribute('src');
    code.textContent = '';
    result.textContent = 'Aguarde…';
    const authorization = 'Bearer ' + token.value.trim();
    try {
      const options = { headers: { Authorization: authorization }, cache: 'no-store' };
      if (action !== 'qr-image') {
        options.method = 'POST';
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify({ number: number.value });
      }
      const response = await fetch('/admin/' + action, options);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a solicitação.');
      if (action === 'qr-image') {
        qrImage.src = data.image;
        qrImage.hidden = false;
        result.textContent = 'Escaneie o QR Code em Aparelhos conectados. Se expirar, toque em Mostrar QR Code de novo.';
      } else if (action === 'pair-reset') {
        result.textContent = 'Nova sessão em preparação. Aguarde alguns segundos e tente Mostrar QR Code ou Gerar código.';
      } else {
        code.textContent = data.code;
        result.textContent = 'Digite este código no WhatsApp do bot.';
      }
    } catch (error) {
      result.textContent = error.message === 'Failed to fetch'
        ? 'Falha ao acessar o serviço. Tente novamente.'
        : error.message;
    } finally {
      buttons.forEach(button => button.disabled = false);
    }
  }
  form.addEventListener('submit', event => { event.preventDefault(); void pair('pair'); });
  document.getElementById('show-qr').addEventListener('click', () => void pair('qr-image'));
  document.getElementById('reset').addEventListener('click', () => void pair('pair-reset'));
  const el = id => document.getElementById(id);
  async function admin(path, body) {
    if (!token.value.trim()) throw new Error('Informe o ADMIN_TOKEN do Render.');
    const headers = { Authorization: 'Bearer ' + token.value.trim() };
    const options = { headers, cache: 'no-store' };
    if (body !== undefined) {
      options.method = 'POST';
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    const response = await fetch('/admin/' + path, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível concluir.');
    return data;
  }
  async function executar(statusId, action) {
    const aviso = el(statusId);
    aviso.textContent = 'Aguarde…';
    try { aviso.textContent = await action(); }
    catch (error) { aviso.textContent = error.message; }
  }
  el('settings-load').addEventListener('click', () => void executar('owner-result', async () => {
    const dono = await admin('owner');
    el('owner-name').value = dono.name;
    el('owner-number').value = dono.number;
    el('owner-lid').value = dono.lid || '';
    return 'Cadastro carregado.';
  }));
  el('owner').addEventListener('submit', event => {
    event.preventDefault();
    void executar('owner-result', async () => {
      await admin('owner', { name: el('owner-name').value, number: el('owner-number').value, lid: el('owner-lid').value });
      return 'Dono salvo. Teste !dono e !reiniciar no grupo.';
    });
  });
  const fields = {
    nickname: 'group-name', welcomeText: 'group-welcome', goodbyeText: 'group-goodbye',
    welcomeText2: 'group-welcome2', goodbyeText2: 'group-goodbye2', mode: 'group-greet'
  };
  let groupSelection = 0;
  el('settings-groups').addEventListener('click', () => void executar('group-result', async () => {
    const { groups } = await admin('groups');
    groupSelection++;
    el('group-fields').disabled = true;
    const first = document.createElement('option');
    first.value = '';
    first.textContent = 'Selecione um grupo';
    el('group-id').replaceChildren(first);
    for (const group of groups) {
      const option = document.createElement('option');
      option.value = group.id;
      option.textContent = group.name;
      el('group-id').append(option);
    }
    return groups.length ? 'Grupos sincronizados. Selecione um grupo.' : 'O bot não participa de grupos.';
  }));
  el('group-id').addEventListener('change', () => {
    const selection = ++groupSelection;
    const jid = el('group-id').value;
    el('group-fields').disabled = true;
    if (!jid) return;
    void executar('group-result', async () => {
      const values = await admin('group?jid=' + encodeURIComponent(jid));
      if (selection !== groupSelection) return '';
      for (const [key, id] of Object.entries(fields)) el(id).value = values[key] || '';
      el('group-fields').disabled = false;
      return 'Configuração carregada.';
    });
  });
  el('group').addEventListener('submit', event => {
    event.preventDefault();
    const jid = el('group-id').value;
    const values = Object.fromEntries(Object.entries(fields).map(([key, id]) => [key, el(id).value]));
    void executar('group-result', async () => {
      await admin('group', { jid, ...values });
      return 'Configuração do grupo salva. O bot já pode usá-la.';
    });
  });

</script>
</html>`);
});
app.get('/health',(_req,res)=>res.json({ok:true,status,funcoes:paused?'pausadas':'ativas',prefixo:prefix,revisao:'painel-v10'}));
app.get('/admin/owner', protect, (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(ownerSaved || defaultOwner);
});
app.post('/admin/owner', protect, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const candidate = validateOwner(req.body);
  if (!candidate) {
    return res.status(400).json({ error: 'Use um nome de até 60 caracteres, número com DDI e DDD e, se informado, LID no formato 12345@lid.' });
  }
  const previous = ownerSaved || defaultOwner;
  if (candidate.number !== previous.number && candidate.lid && candidate.lid === previous.lid) {
    return res.status(400).json({ error: 'Ao trocar o número do dono, informe o LID da nova conta ou deixe o campo vazio.' });
  }
  try {
    writeFileSync(ownerPath + '.tmp', JSON.stringify(candidate), { mode: 0o600 });
    renameSync(ownerPath + '.tmp', ownerPath);
    ownerSaved = candidate;
    return res.json({ saved: true });
  } catch (error) {
    logger.error({ code: error.code }, 'Falha ao salvar dono');
    return res.status(500).json({ error: 'Não consegui gravar o dono. Confira SESSION_DIR no Render.' });
  }
});

const groupFields = { nickname: 32, welcomeText: 500, goodbyeText: 500, welcomeText2: 500, goodbyeText2: 500 };
const groupId = /^\d+(?:-\d+)?@g\.us$/;
async function connectedGroups(res, operation) {
  res.set('Cache-Control', 'no-store');
  const current = sock;
  if (status !== 'conectado' || !current) return res.status(409).json({ error: 'Conecte o WhatsApp para sincronizar os grupos.' });
  try {
    const groups = await current.groupFetchAllParticipating();
    if (current !== sock || status !== 'conectado') return res.status(409).json({ error: 'A conexão mudou. Sincronize novamente.' });
    return operation(groups);
  } catch (error) {
    logger.warn({ code: error.code }, 'Falha no painel de grupos');
    return res.status(502).json({ error: 'Não consegui sincronizar os grupos. Confira a conexão e os logs do Render.' });
  }
}
function groupSettings(jid) {
  const saved = handleGroup.groupSettings(jid);
  return {
    ...Object.fromEntries(Object.keys(groupFields).map(key => [key, saved[key] || ''])),
    mode: saved.bemvindo2 ? 'two' : saved.bemvindo ? 'one' : 'off',
  };
}
app.get('/admin/groups', protect, (_req, res) => connectedGroups(res, groups => {
  return res.json({ groups: Object.values(groups).filter(group => groupId.test(group.id || ''))
    .map(group => ({ id: group.id, name: group.subject || group.id })) });
}));
app.get('/admin/group', protect, (req, res) => connectedGroups(res, groups => {
  const jid = req.query.jid;
  if (typeof jid !== 'string' || !groupId.test(jid) || !Object.hasOwn(groups, jid)) {
    return res.status(404).json({ error: 'O WhatsApp conectado não participa desse grupo.' });
  }
  return res.json(groupSettings(jid));
}));
app.post('/admin/group', protect, (req, res) => connectedGroups(res, groups => {
  const { jid, mode } = req.body || {};
  if (typeof jid !== 'string' || !groupId.test(jid) || !Object.hasOwn(groups, jid)) {
    return res.status(404).json({ error: 'O WhatsApp conectado não participa desse grupo.' });
  }
  const fields = Object.entries(groupFields);
  if (!['off', 'one', 'two'].includes(mode) ||
      fields.some(([key, length]) => typeof req.body[key] !== 'string' || req.body[key].length > length)) {
    return res.status(400).json({ error: 'Revise os campos. Apelido: até 32 caracteres. Legendas: até 500.' });
  }
  const changes = Object.fromEntries(fields.map(([key]) => [key, req.body[key].trim()]));
  try {
    handleGroup.saveGroupSettings(jid, { ...changes, bemvindo: mode === 'one', bemvindo2: mode === 'two' });
    return res.json(groupSettings(jid));
  } catch (error) {
    logger.error({ code: error.code }, 'Falha ao salvar configuração do grupo');
    return res.status(500).json({ error: 'Não consegui gravar o grupo. Confira SESSION_DIR no Render.' });
  }
}));
app.get('/admin/status',protect,(_req,res)=>res.json({status,paused,qrDisponivel:!!qr}));
app.post('/admin/pause',protect,(req,res)=>{
  if(typeof req.body?.paused!=='boolean')return res.status(400).json({error:'Informe paused como true ou false'});
  paused=req.body.paused;
  res.json({paused});
});
app.get('/admin/qr',protect,(_req,res)=>res.json({qr:qr||null}));
function pairingProblem() {
  if (status === 'conectado') return 'O ZUMY já está conectado ao WhatsApp.';
  if (status === 'sessao_expirada' || status === 'conexao_substituida') {
    return 'A sessão está encerrada. Toque em Preparar nova sessão.';
  }
  if (!sock || !qr || status !== 'aguardando_pareamento') {
    return 'O WhatsApp ainda está preparando o pareamento. Aguarde alguns segundos.';
  }
}

app.get('/admin/qr-image', protect, async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  const problema = pairingProblem();
  if (problema) return res.status(409).json({ error: problema });
  try {
    const image = await QRCode.toDataURL(qr, { width: 300, margin: 3 });
    return res.json({ image });
  } catch {
    return res.status(500).json({ error: 'Não foi possível desenhar o QR Code. Tente Gerar código.' });
  }
});

app.post('/admin/pair', protect, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const number = String(req.body?.number || '').replace(/\D/g, '');
  if (!/^55\d{10,11}$/.test(number)) return res.status(400).json({ error: 'Informe 55 + DDD + número do bot.' });
  const problema = pairingProblem();
  if (problema) return res.status(409).json({ error: problema });
  if (pairingInProgress) return res.status(409).json({ error: 'Já existe um pedido de código em andamento.' });
  pairingInProgress = true;
  const current = sock;
  try {
    const code = await current.requestPairingCode(number);
    if (sock !== current && status !== 'conectado') {
      return res.status(409).json({ error: 'A conexão mudou durante o pedido. Aguarde e tente novamente.' });
    }
    return res.json({ code });
  } catch (error) {
    const code = error.output?.statusCode || error.code;
    logger.warn({ code, name: error.name }, 'Falha ao gerar código de pareamento');
    const hint = code ? ' Código do erro: ' + code + '.' : '';
    return res.status(502).json({ error: 'O WhatsApp não gerou o código. Tente Mostrar QR Code.' + hint });
  } finally {
    pairingInProgress = false;
  }
});

app.post('/admin/pair-reset', protect, (_req, res) => {
  res.set('Cache-Control', 'no-store');
  if (status === 'conectado') return res.status(409).json({ error: 'O WhatsApp já está conectado. A sessão ativa foi preservada.' });
  if (pairingInProgress || !['sessao_expirada', 'conexao_substituida', 'aguardando_pareamento'].includes(status)) {
    return res.status(409).json({ error: 'Aguarde a tentativa atual terminar antes de preparar uma nova sessão.' });
  }
  try {
    prepareNewAuthFolder();
    const current = sock;
    sock = null;
    qr = null;
    status = 'preparando_pareamento';
    attempt = 0;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    scheduleReconnect();
    try { current?.end(new Error('Nova sessão solicitada')); }
    catch (error) { logger.warn({ name: error.name }, 'Falha ao fechar socket anterior'); }
    return res.status(202).json({ status });
  } catch (error) {
    logger.error({ name: error.name, code: error.code }, 'Falha ao preparar nova sessão');
    return res.status(500).json({ error: 'Não foi possível preparar a sessão. Confira SESSION_DIR e os logs do Render.' });
  }
});
app.listen(port,'0.0.0.0',()=>logger.info({port},'ZUMY HTTP iniciado'));
function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = Math.min(30000, 2000 * 2 ** Math.min(attempt++, 4));
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    if (!sock) void startConnection();
  }, delay);
}

async function startConnection() {
  try {
    await connect();
  } catch (error) {
    status = 'aguardando_reconexao';
    logger.error({ err: error }, 'Falha ao iniciar conexão WhatsApp');
    scheduleReconnect();
  }
}

async function connect(){
  status='conectando';const {state,saveCreds}=await useMultiFileAuthState(activeAuthFolder());
  const current=makeWASocket({auth:state,logger:logger.child({module:'baileys'}),printQRInTerminal:false,markOnlineOnConnect:false, syncFullHistory:false});sock=current;
  const processed = new Map();
  let connectedAt = 0;
  current.ev.on('creds.update', () => {
    saveCreds().catch(error => logger.error({ err: error }, 'Falha ao salvar sessão WhatsApp'));
  });
  current.ev.on('connection.update',({connection,lastDisconnect,qr:nextQr})=>{
    if(current!==sock)return;
    if(nextQr){status='aguardando_pareamento';qr=nextQr;logger.info('QR de pareamento disponível')}
    if(connection==='open'){connectedAt=Date.now();status='conectado';qr=null;attempt=0;logger.info('ZUMY WhatsApp conectado')}
    if(connection==='close'){
      sock=null;qr=null;
      const code=lastDisconnect?.error?.output?.statusCode;
      logger.warn({code},'Conexão WhatsApp encerrada');
      if (code === DisconnectReason.loggedOut) {
        status = 'sessao_expirada';
        if (!state.creds?.registered) {
          logger.warn('Sessão sem vínculo recusada pelo WhatsApp. Confira os logs antes de tentar novamente.');
          return;
        }
        try {
          prepareNewAuthFolder();
          status = 'preparando_pareamento';
          attempt = 0;
          logger.info('Sessão encerrada. Preparando novo pareamento.');
          scheduleReconnect();
        } catch (error) {
          logger.error({ code: error.code, name: error.name }, 'Falha ao preparar novo pareamento');
        }
        return;
      }
      if(code===DisconnectReason.connectionReplaced){
        status='conexao_substituida';
        logger.warn('Conexão substituída. Confira se a sessão está aberta em outra instância.');
        return;
      }
      status='aguardando_reconexao';
      scheduleReconnect();
    }
  });
  current.ev.on('group-participants.update', event => {
    if (paused || current !== sock) return;
    handleGroup.onParticipantsUpdate(current, event)
      .catch(error => logger.warn({ err: error }, 'Falha na mensagem de boas-vindas'));
  });
  function commandText(message) {
    while (message?.ephemeralMessage?.message || message?.documentWithCaptionMessage?.message) {
      message = message.ephemeralMessage?.message || message.documentWithCaptionMessage.message;
    }
    return (message?.conversation || message?.extendedTextMessage?.text || message?.imageMessage?.caption ||
      message?.videoMessage?.caption || message?.documentMessage?.caption || '').trim();
  }

  current.ev.on('messages.upsert', async ({ messages, type }) => {
    if (paused || current !== sock || !['notify', 'append'].includes(type)) return;
    const now = Date.now();
    for (const [key, receivedAt] of processed) {
      if (now - receivedAt <= 120_000) break;
      processed.delete(key);
    }
    for (const msg of messages || []) {
      if (paused || current !== sock) break;
      const { remoteJid, remoteJidAlt, id, fromMe } = msg?.key || {};
      if (!msg?.message || !remoteJid) continue;
      const text = commandText(msg.message);
      const group = remoteJid.endsWith('@g.us');
      const identityRequest = !group && type === 'notify' && !fromMe &&
        /^\d+(?::\d+)?@(lid|s\.whatsapp\.net|c\.us)$/.test(remoteJid) &&
        text.toLowerCase() === prefix + 'meuid';
      if (!group && !identityRequest) continue;
      const isCommand = text.startsWith(prefix) || /^zoom(?:$|[\s,:])/i.test(text);
      const hasTrigger = isCommand || chamouZumy(text);
      if (type === 'append' || (fromMe && hasTrigger)) {
        const sentAt = Number(msg.messageTimestamp) * 1000;
        if (!fromMe || !hasTrigger || !connectedAt || !Number.isFinite(sentAt) ||
            sentAt < Math.max(connectedAt - 999, now - 30_000) || sentAt > now + 10_000) continue;
      }
      const key = id && remoteJid + ':' + id;
      if (key && processed.has(key)) continue;
      if (key) {
        if (processed.size >= 2048) processed.delete(processed.keys().next().value);
        processed.set(key, now);
      }
      if (isCommand) logger.info({ type, fromMe: Boolean(fromMe) }, 'Comando recebido do WhatsApp');
      try {
        if (identityRequest) {
          await current.sendMessage(remoteJid, { text: identidadePrivada([remoteJid, remoteJidAlt]) });
        } else {
          await handleGroup(current, msg);
        }
      } catch (error) {
        logger.error({ err: error }, 'Erro ao processar mensagem de grupo');
        if (isCommand) {
          await current.sendMessage(remoteJid, { text: 'Não consegui concluir o comando agora.' }, { quoted: msg })
            .catch(err => logger.warn({ err }, 'Falha ao informar erro do comando'));
        }
      }
    }
  });
}
let communityRunning = false;
const communityTimer = setInterval(async () => {
  if (communityRunning || paused || status !== 'conectado' || !sock) return;
  communityRunning = true;
  try { await handleGroup.tick(sock); }
  catch (error) { logger.warn({ name: error.name }, 'Falha ao rodar os automáticos'); }
  finally { communityRunning = false; }
}, 60_000);
communityTimer.unref();
void startConnection();
