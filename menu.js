export const botName = 'ZUMY';
export const ownerName = 'T.K PLAY TV';
export const prefix = '!';
export const ownerNumber = '5582996813027';

export const sections = [
  ['PRINCIPAL', '📋', 'menu|ajuda|dono|meuid|ping|status|infobot|regras'],
  ['ADMINISTRAÇÃO', '👑', 'b|d|ban|kick|promover|rebaixar|grupo a|grupo f|abrirgp|fechargp|marcar|linkgp|add|castigo|liberarcastigo|limpar|listban|listanegra|listabranca|tirardalista|banfake'],
  ['SEGURANÇA', '🛡️', 'antilink on|antilink off|antispam on|antispam off|antivizu on|antivizu off|antivizu status|antigaviao on|antigaviao off|detectargado on|detectargado off|zoeira on|zoeira off'],
  ['RANKINGS', '🤣', 'rankcorno|rankmoia|ranknoia|rankcaloteiro|rankgaviao|rankgado|rankbebado|rankfofoqueiro|rankpreguicoso|rankdoido|rankciumento|rankpegador|ranksumido|rankchorao|ranksortudo|rankazarado|ranklevel|rankativos|rankdia|ranklesbica|rankgay|rankmentiroso|topfood|checkativos|atividades|inativos'],
  ['RELACIONAMENTOS', '❤️', 'ship|casal|compatibilidade|apaixonado|crush|casamento|divorcio|beijo|namorar|quemmeama|quemmetraiu|perfil|amizade|pegar|cancelarpedido|terminanamoro|aceitar|curriculo|dogolpe|golpe'],
  ['JOGOS', '🎮', 'jogos|verdade|desafio|verdadeoudesafio|roleta|dado|parouimpar|pedra|papel|tesoura|adivinhar|quiz|forca|sorteio|bingo'],
  ['ZOEIRAS', '😂', 'queme|eununca|confissao|segredo|azar|sorte|previsao|horoscopo|testedeamor|testedebeleza|testedeloucura|quemseria|duelo|batalha|espiar|aura|confessar|signo|previsaodotempo|calor|chuva|dataehora'],
  ['FIGURINHAS', '🖼️', 'fig|sticker|toimg|attp|ttp'],
  ['MÚSICAS', '🎵', 'play|p|buscar|musica|letra'],
  ['INTELIGÊNCIA ARTIFICIAL', '🧠', 'ia|perguntar|resumir|traduzir'],
  ['PROPRIETÁRIO', '⚙️', 'reiniciar|bloquear|desbloquear|broadcast|grupos'],
  ['ANTI-CONTEÚDO', '🚫', 'antiimg|antivideo|antiaudio|antisticker|antiloc|anticontato|antidoc|anticatalogo|antinotas|antipayment|antienquete'],
  ['ANTI-SPAM E SEGURANÇA', '🛡️', 'antilinkgp|antilinkhard|antiflod|limitecaracteres|antipalavra|addpalavra|delpalavra|listapalavra|listapalavrao'],
  ['CONFIGURAÇÃO DO GRUPO', '⚙️', 'configurar|sync|autorepro|antiporno|autodownload|imagembv|vozzumy|testarvoz|bemvindo|bemvindo2|legendabv|legendasaiu|legendabv2|legendasaiu2|legendasaiureset|legendasaiu2reset|autosticker|atodos|modobrincadeira|soadm|liberar|revogar|liberados|cooldown|limitecmd|tempocmd|msgtemp|advertir|advertencia|advertenciaauto|apelido'],
  ['FERRAMENTAS DE ADMINISTRAÇÃO', '👮', 'nomegp|admins|adms|totag|hidetag|del|blockcmdgp|unblockcmdgp|listbcmdgp|enquete|sorteionumero'],
  ['ATALHOS ZOOM', '🐉', 'zoom abre o grupo|zoom fecha o grupo|zoom remova esse|zoom marca todo mundo|zoom baixe música NOME|zoom forme um casal|zoom que horas são|zoom quantos membros tem aqui|zoom enquete: X ou Y'],
].map(([title, icon, commands]) => ({ title, icon, commands: commands.split('|') }));

export const categoryCommands = [
  'principal', 'administracao', 'seguranca', 'rankings', 'relacionamentos',
  'jogos', 'zoeiras', 'figurinhas', 'musicas', 'inteligenciaartificial', 'proprietario', 'anticonteudo', 'antispamseguranca', 'configuracao', 'ferramentasadm', 'autonomia',
];
function panel(title, lines) {
  return [
    '┎┅┅┅━═⋅═━━━━═⋅═━┅┅┅☾⋆',
    '┖╮ ★彡[' + title + ']彡★',
    '┇├┉━┅━┅━┅━┅━┅━⋅≎⋆ᐧ',
    ...lines.map(line => '┇┆' + line),
    '┇╰┉━┅━┅━┅━┅━┅━⋅≎⋆ᐧ',
    '╰┮╼╼╼╼╍⋅⊹⋅⦁ ✪ ⦁⋅⊹⋅╍╾╾╾╾☾⋆',
  ].join('\n');
}
const switches = new Set((sections[11].commands).concat(['antilinkgp', 'antilinkhard', 'antiflod',
  'limitecaracteres', 'antipalavra', 'bemvindo', 'bemvindo2', 'autosticker', 'atodos', 'modobrincadeira', 'soadm', 'advertenciaauto']));
const usage = { play: ' NOME, lista ou artista NOME', p: ' NOME, lista ou artista NOME', totag: ' MENSAGEM', castigo: ' 24h @participante', liberarcastigo: ' @participante', espiar: ' @participante',
  sync: ' [1/0]', imagembv: ' (responda a uma foto)', perfil: ' [2]', aceitar: ' namorar S/N',
  cancelarpedido: ' @participante', terminanamoro: ' T', previsaodotempo: ' CIDADE', calor: ' CIDADE', chuva: ' CIDADE',
  signo: ' NOME', autorepro: ' 1/0', antiporno: ' 1/0', autodownload: ' 1/0', vozzumy: ' anime/doce/calma/grave', apelido: ' [nome ou reset]', enquete: ' Pergunta | Opção 1 | Opção 2' };

function category(section) {
  return panel(section.icon + ' ' + section.title, section.commands.map(command => {
    if (command.startsWith('zoom ')) return '“' + command + '”';
    return prefix + command + (switches.has(command) ? ' (1/0)' : usage[command] || '');
  }));
}

export function menu(selection = '', { nickname, user, ownerLabel = ownerName } = {}) {
  const cleanUser = String(user || '').replace(/[\r\n*]/g, ' ').trim().slice(0, 55);
  const header = panel('ℹ️ INFORMAÇÃO', [
    '⚙️ *Prefixo*: 「 ' + prefix + ' 」',
    '🤖 *Bot*: ' + (nickname || botName),
    ...(cleanUser ? ['👤 *Usuário*: ' + cleanUser] : []),
    '📄 *Versão*: 3.1',
    '👑 *Dono*: ' + ownerLabel,
  ]);
  if (selection.toLowerCase() === 'completo') return [header, ...sections.map(category)].join('\n▹▫◃\n');
  if (selection) {
    const section = /^\d+$/.test(selection)
      ? sections[Number(selection) - 1]
      : sections[categoryCommands.indexOf(normalizeCommand(selection))];
    return section ? category(section) + '\n\nVoltar: zoom' : 'Digite zoom para ver os atalhos.';
  }
  const index = sections.map(({ title, icon }, i) => icon + ' ' + prefix + categoryCommands[i] + ' · ' + title);
  return header + '\n▹▫◃\n' + panel('CATEGORIAS', [...index, 'Lista completa: !menu completo']);
}

export const normalizeCommand = value => value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[-_]/g, '');
