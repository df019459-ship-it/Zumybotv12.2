# Zumybot · Painel v10

## Atualizar no GitHub

Envie os arquivos extraídos deste pacote para a raiz da branch `main` do repositório Zumybot3.1.0. O `package.json` inclui a biblioteca de QR Code. Mantenha os arquivos MP3 e M4A que já estão no repositório.

Abra o serviço do bot no Render e publique o último commit. Em `/health`, a revisão deve aparecer como `painel-v10`.

## Persistir o cadastro e o WhatsApp

Mantenha `ADMIN_TOKEN` configurado como segredo no Render. Use seu valor somente na página `/parear`.

Confirme em **Disks** que o serviço tem um disco persistente e que `SESSION_DIR` aponta para uma pasta dentro do ponto de montagem. Exemplo: disco montado em `/var/data` e variável `SESSION_DIR=/var/data/zumy-session`. Se já usa uma pasta persistente, mantenha o endereço atual para reaproveitar a sessão. Se a pasta anterior era temporária, a primeira instalação no novo disco pode exigir pareamento. A pasta guarda as credenciais da conexão, o cadastro do dono e as configurações de cada grupo em arquivos separados.

## Usar o painel

1. Em `/parear`, informe o `ADMIN_TOKEN`. Na seção **Dono do bot**, toque em **Carregar cadastro**, informe o nome e telefone da conta responsável e salve. Se o WhatsApp apresentar essa conta apenas por LID, mande `!meuid` com ela e salve o LID que o bot enviar em privado. O número do dono pode ser diferente do número usado para parear.
2. Teste `!dono` para confirmar o nome e `!reiniciar` pela conta do dono para verificar a permissão. Pare na solicitação de confirmação para evitar reiniciar.
3. Se o WhatsApp estiver desconectado, use **Mostrar QR Code** ou **Gerar código** com o número da conta do bot. Use **Preparar nova sessão** quando a sessão estiver encerrada e o painel indicar essa opção.
4. Com o WhatsApp conectado, toque em **Sincronizar grupos**. Selecione o grupo e ajuste o apelido, o modo de boas-vindas e as legendas. As alterações são aplicadas no grupo selecionado assim que forem salvas.
5. O menu de música inclui `!play lista`, `!play artista NOME` e `!play archive MÚSICA | ARTISTA`.

Salvar o cadastro do dono não reinicia o processo nem altera o pareamento. Se o WhatsApp desvincular a sessão, será preciso vincular de novo.

## Comandos e exemplos da v10

### Administração

| Comando | Uso |
|---|---|
| `!sync` / `!sync 0` | Ativa ou pausa níveis, ranking diário, saudações e lembretes do grupo. |
| `!configurar grupo` | Abre o menu de configuração. |
| `!imagembv` | Responda a uma foto de até 1 MB. Ative as boas-vindas com `!bemvindo 1` ou `!bemvindo2 1`. Use `!imagembv reset` para remover a imagem. |
| `!castigo 24h @participante` | Apaga novas mensagens da pessoa durante o prazo. Aceita minutos, horas e dias, até sete dias. O bot deve ser administrador. |
| `!liberarcastigo @participante` | Encerra o castigo. Também aceita `!tliberarcastogo @participante`. |
| `!limpar` | Apaga a mensagem à qual você respondeu, conforme as permissões do WhatsApp. |
| `!listban` | Mostra os últimos banimentos feitos pelo bot e a lista de bloqueio. |
| `!listanegra @participante` | Bloqueia a próxima entrada da conta. Também aceita `!listanegram`. |
| `!listabranca @participante` | Adiciona a conta à lista branca. Também aceita `!listanranca`. |
| `!tirardalista @participante` | Retira a conta das duas listas. Também aceita `!tirardalistar`. |
| `!ban @participante` / `!b @participante` | Remove a conta. Também aceita o comando colado à menção, se for uma marcação válida. |
| `!autorepro 1` / `!autorepro 0` | Liga ou desliga a resposta automática quando alguém chama a Zumy. Aceita `!aurorepro1` e `!autorepo 0`. |
| `!antiporno 1` / `!antiporno 0` | Filtra localmente palavras em textos e legendas. Use `!addpalavra TERMO` para cadastrar mais. |
| `!autodownload 1` / `!autodownload 0` | Liga ou desliga o envio automático de links elegíveis do Archive ou da origem de áudio configurada. Aceita `!autodowload`. |
| `!listapalavrao` | Mostra as palavras cadastradas com `!addpalavra`. |
| `!marcar MENSAGEM` / `!totag MENSAGEM` | Marca com os nomes disponíveis e alterna o tema. `!totag` também aceita responder a um aviso. |

### Usuários

| Comando | Uso |
|---|---|
| `!espiar @participante` | Mostra o perfil disponível no grupo e a última atividade registrada. |
| `!aura` | Sorteia uma aura de brincadeira. |
| `!confessar MENSAGEM` | Publica a mensagem no grupo. |
| `!banfake @participante` | Faz uma brincadeira de banimento. |
| `!ranklevel`, `!rankativos`, `!rankdia` / `!rankdodia` | Mostra níveis, patentes, interações e percentual no ranking. |
| `!rank mentiroso` / `!rankmentiroso` | Sorteia um ranking fictício. |
| `!rankgay participar`, `!ranklesbica participar` | Entra voluntariamente no ranking escolhido. Use o comando sem argumento para consultar e com `sair` para sair. |
| `!topfood` | Atalho para o ranking de atividade. |
| `!checkativos`, `!atividades ✅`, `!inativos ❌` | Consultam a atividade registrada no grupo. |
| `!previsão do tempo Fortaleza`, `!calor Fortaleza`, `!chuva Fortaleza` | Consultam clima, temperatura e chuva pelo Open-Meteo. |
| `!data e hora` | Mostra o dia e a hora no fuso do bot. |
| `!signo Leão` | Envia um horóscopo de brincadeira. |
| `!perfil` / `!perfil 2` | Mostra foto disponível, interações, nível e patente. A opção 2 inclui a última atividade. |
| `!amizade @pessoa`, `!pegar @pessoa`, `!namorar @pessoa` | Enviam um pedido. Só a pessoa marcada pode responder em até cinco minutos. |
| `!aceitar namorar S` | Aceita o pedido. Use `N` para recusar. Também aceita `amizade` e `pegar`. |
| `!cancelarpedido @pessoa` / `!terminanamoro T` | Cancela um pedido seu ou termina o namoro de brincadeira. |
| `!currículo @pessoa` | Gera um currículo do amor de brincadeira. |
| `!dogolpe`, `!dogolpe @pessoa`, `!golpe @pessoa` | Sorteiam uma brincadeira com percentual. |

Rankings usam imagem temática quando o FFmpeg está disponível. O ranking de atividade usa o percentual de interações registradas. Brincadeiras usam percentuais sorteados.

### Rotinas depois de `!sync`

- **6h, 12h e 18h** — Zumy cumprimenta, informa data e hora e usa o estilo anime quando a voz estiver disponível.
- **20h** — ranking do dia.
- **Após duas horas de inatividade** — uma marcação por período de ausência. Quando a pessoa volta a interagir, o bot pode marcar novamente após outra ausência.

O fuso padrão é Fortaleza. As rotinas são verificadas a cada minuto com o WhatsApp conectado. `!sync 0` pausa essas rotinas naquele grupo.
