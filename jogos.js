import { randomInt } from 'node:crypto';
import { menu } from './menu.js';

const pick = values => values[randomInt(values.length)];
const questions = [
  ['Qual é a capital do Brasil?', 'brasilia'],
  ['Quanto é 7 × 8?', '56'],
  ['Qual é o maior planeta do Sistema Solar?', 'jupiter'],
  ['Que planeta é chamado de Planeta Vermelho?', 'marte'],
];
const words = ['pipoca', 'amizade', 'figurinha', 'brasil', 'cachorro'];
const normalize = value => value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

export function createGames() {
  const rounds = new Map();
  const get = (jid, game) => {
    if (!rounds.has(jid)) rounds.set(jid, new Map());
    const group = rounds.get(jid);
    return { current: group.get(game), set: value => group.set(game, value), clear: () => group.delete(game) };
  };

  function playRound({ jid, arg, reply }, game, instructions, start, turn) {
    const { current, set, clear } = get(jid, game);
    const input = normalize(arg);
    if (input === 'cancelar') {
      clear();
      return reply('Rodada encerrada.');
    }
    if (input === 'iniciar' && !current) {
      const [state, message] = start();
      set(state);
      return reply(message);
    }
    if (!current || !input || input === 'iniciar') return reply(instructions);
    const [message, finished] = turn(current, input);
    if (finished) clear();
    return reply(message);
  }

  function draw({ members, mention, reply }) {
    return members.length ? mention('🎉 Sorteado: ', [pick(members)]) : reply('Nenhum participante disponível.');
  }

  function rps(command, { reply }) {
    const choices = ['pedra', 'papel', 'tesoura'];
    const choice = pick(choices);
    const result = choice === command ? 'Empate!' :
      choices[(choices.indexOf(choice) + 1) % 3] === command ? 'Você ganhou!' : 'ZUMY ganhou!';
    return reply('ZUMY jogou ' + choice + '. ' + result);
  }

  return {
    jogos: ({ reply }) => reply(menu('6')),
    verdade: ({ reply }) => reply(pick(['Qual hábito seu surpreenderia o grupo?', 'Qual foi sua maior vergonha engraçada?'])),
    desafio: ({ reply }) => reply(pick(['Invente uma cantada com a palavra pipoca.', 'Descreva seu dia usando três emojis.'])),
    verdadeoudesafio: context => pick(['verdade', 'desafio']) === 'verdade'
      ? context.reply('Verdade: qual foi a coisa mais engraçada que você já fez?')
      : context.reply('Desafio: mande uma frase que rime com seu nome.'),
    roleta: draw,
    sorteio: draw,
    dado: ({ reply }) => reply('🎲 ' + randomInt(1, 7)),
    pedra: context => rps('pedra', context),
    papel: context => rps('papel', context),
    tesoura: context => rps('tesoura', context),
    parouimpar: ({ arg, reply }) => {
      const match = /^(par|impar) ([0-5])$/.exec(normalize(arg));
      if (!match) return reply('Use !parouimpar par 3 ou !parouimpar impar 3. Escolha de 0 a 5.');
      const bot = randomInt(6);
      const total = bot + Number(match[2]);
      const result = total % 2 ? 'impar' : 'par';
      return reply('Joguei ' + bot + '. Total: ' + total + ' (' + result + '). ' +
        (match[1] === result ? 'Você ganhou!' : 'ZUMY ganhou!'));
    },
    adivinhar: context => playRound(context, 'adivinhar', 'Use !adivinhar iniciar e depois !adivinhar número de 1 a 20.',
      () => [{ number: randomInt(1, 21), attempts: 5 }, 'Adivinhe o número de 1 a 20. Você tem 5 tentativas.'],
      (round, input) => {
        if (!/^(?:[1-9]|1\d|20)$/.test(input)) return ['Informe um número de 1 a 20.', false];
        const number = Number(input);
        if (number === round.number) return ['🎉 Você acertou!', true];
        round.attempts--;
        if (!round.attempts) return ['O número era ' + round.number + '.', true];
        return ['Tente um número ' + (number < round.number ? 'maior' : 'menor') + '. Restam ' + round.attempts + ' tentativas.', false];
      }),
    quiz: context => playRound(context, 'quiz', 'Use !quiz iniciar e depois !quiz sua resposta.',
      () => {
        const [question, answer] = pick(questions);
        return [{ answer, attempts: 3 }, '❓ ' + question + '\nResponda com !quiz resposta.'];
      },
      (round, input) => {
        if (input === round.answer) return ['🎉 Resposta certa!', true];
        round.attempts--;
        if (!round.attempts) return ['A resposta era ' + round.answer + '.', true];
        return ['Resposta incorreta. Restam ' + round.attempts + ' tentativas.', false];
      }),
    forca: context => playRound(context, 'forca', 'Use !forca iniciar e depois !forca letra ou palavra.',
      () => {
        const word = pick(words);
        return [{ word, used: new Set(), mistakes: 0 }, '🔤 ' + [...word].map(() => '＿').join(' ')];
      },
      (round, input) => {
        if (!/^[a-z]+$/.test(input)) return ['Informe uma letra ou palavra.', false];
        if (input === round.word) return ['🎉 Palavra certa: ' + round.word, true];
        if (round.used.has(input)) return ['Palpite já usado.', false];
        round.used.add(input);
        if (input.length !== 1 || !round.word.includes(input)) round.mistakes++;
        if (round.mistakes >= 6) return ['Fim da rodada. A palavra era ' + round.word + '.', true];
        const visible = [...round.word].map(letter => round.used.has(letter) ? letter : '＿');
        if (!visible.includes('＿')) return ['🎉 Palavra certa: ' + round.word, true];
        return [visible.join(' ') + ' · Erros: ' + round.mistakes + '/6', false];
      }),
    bingo: ({ jid, arg, isAdmin, reply }) => {
      const { current, set } = get(jid, 'bingo');
      if (arg === 'reset' && !isAdmin) return reply('Só administradores podem reiniciar o bingo.');
      if (arg && arg !== 'reset') return reply('Use !bingo para sortear ou !bingo reset para reiniciar.');
      const remaining = !current || arg === 'reset' ? Array.from({ length: 75 }, (_, i) => i + 1) : current;
      if (!remaining.length) return reply('Todas as 75 bolas foram sorteadas. Use !bingo reset.');
      const [number] = remaining.splice(randomInt(remaining.length), 1);
      set(remaining);
      return reply('🎱 Bola ' + number + ' (' + (75 - remaining.length) + '/75)');
    },
  };
}
