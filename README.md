# HaxBall Headless Room — Sistema Completo

Sala HaxBall Headless com Supabase: registro, economia, loja, admin e auto-team.

## Estrutura do Projeto

```
├── main.js                          # Bootstrap (Puppeteer + HBInit)
├── package.json
├── .env.example
├── migration.sql                    # Migration obrigatória p/ Supabase
├── schema.sql                       # Schema de referência
└── src/
    ├── config/
    │   ├── supabase.js              # Cliente Supabase (service key)
    │   ├── room.js                  # RoomConfigObject (env vars)
    │   ├── ratingConfig.js          # Configurações do Rating e limites de time
    │   └── stadium.js               # Mapa Futsal x3 by Bazinga
    ├── session/
    │   └── sessionManager.js        # Cache em memória de sessões
    ├── modules/
    │   ├── auth.js                  # !register, carregamento de sessão
    │   ├── altLogin.js              # !setpin, !login (Pin alternativo p/ outra máquina)
    │   ├── economy.js               # !saldo, !addmoney, !rating
    │   ├── shop.js                  # !shop, !buy
    │   ├── matchStats.js            # Registra stats das partidas (Gols, Assist, V/D e Rating)
    │   ├── pickManager.js           # Gerencia Picks do capitão após rotação de times
    │   ├── queueManager.js          # Fila FIFO de espectadores aguardando p/ jogar
    │   ├── skipQueue.js             # !pulafila, !fila (reset via check de cooldown admin/vip)
    │   ├── teamDistribution.js      # Distribuição auto de times
    │   ├── permissions.js           # !getadmin (toggle)
    │   ├── chat.js                  # Prefixos de cargo e rating no chat
    │   └── help.js                  # !help
    └── utils/
        ├── logger.js                # Log com timestamp e níveis
        └── errors.js                # safeAsync, dbCall
```

## Configuração

### 1. Pré-requisitos

- Node.js >= 18
- Conta no [Supabase](https://supabase.com)
- Token HaxBall: https://www.haxball.com/headlesstoken

### 2. Instalar dependências

```bash
npm install
```

### 3. Configurar variáveis de ambiente

```bash
cp .env.example .env
```

Preencha `.env`:

```env
HAXBALL_TOKEN=seu_token
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=sua_service_role_key
ROOM_NAME=Sala BR
ROOM_MAX_PLAYERS=12
ROOM_PUBLIC=false
```

### 4. Executar migration no Supabase

Abra o **SQL Editor** no painel Supabase e execute o conteúdo de `migration.sql`:

```sql
ALTER TABLE public.user_info
  ADD COLUMN IF NOT EXISTS auth_key text UNIQUE;

CREATE INDEX IF NOT EXISTS idx_user_info_auth_key
  ON public.user_info (auth_key);
```

### 5. Iniciar o bot

```bash
node main.js
# ou, para desenvolvimento com reload automático:
node --watch main.js
```

---

## Comandos da Sala

| Comando | Descrição |
|---|---|
| `!register <senha>` | Cria conta vinculada ao seu nickname, token atual e senha |
| `!login <senha>`| Entra na sua conta a partir de outra máquina |
| `!saldo` | Exibe seu saldo atual |
| `!addmoney <v> <n>` | Adiciona saldo para si mesmo ou para `<n>` (Apenas **Admin**) |
| `!shop` | Exibe itens na loja |
| `!buy <chave>` | Compra item pelo key (ex: `!buy vip`, `!buy jump`) |
| `!rating` | Exibe seu rating atual |
| `!fila` | Exibe a fila atual de espectadores aguardando partida |
| `!pulafila` | Vai para o topo da fila (VIPs a cada 15m, Admins a cada 1m) |
| `!getadmin` | Toggle de admin (requer `is_admin = true` no banco) |
| `!help` | Lista todos os comandos |

---

## Sistema de Cargos (Chat)

| Cargo | Prefixo | Cor |
|---|---|---|
| Admin | `⚙️ Nome [Rating]:` | Vermelho |
| VIP | `💎 Nome [Rating]:` | Dourado |
| Usuário | `👤 Nome [Rating]:` | Branco |
| Visitante | `Nome:` | Cinza |

> **Limitação da API:** `sendAnnouncement` aplica cor à mensagem inteira. Não é possível colorir partes distintas do texto — isso é uma limitação real da API HaxBall Headless Host.

---

## Distribuição Automática e Fila (Pick System)

O limite competitivo é estabelecido em **3v3** (configurável em `src/config/ratingConfig.js`).

- **Total ≤ 6:** O sistema distribui automaticamente até 3v3. A partida só vale Rating se for pelo menos 1v1.
- **Total > 6:** 6 jogadores farão a partida e o restante aguardará numa fila de espectadores (`!fila`).
- **Pós Partida (Rotação):**
    - O Time que vence fica em campo.
    - O Time que perde é movido para espectadores.
    - O 1º jogador da fila é adicionado onde era o time perdedor e vira o **Capitão** (!pick).
    - O Capitão tem **60 segundos** para escolher por nome, no chat normal do HaxBall, os seus parceiros de equipe (dentre os elegíveis). O sistema lida ativamente com ambiguidades nas escolhas.

---

## Rating e Tabelas

- Todas as partidas `3v3` alimentam tabelas SQL de match-history e match-statistics.
- **Rating Dinâmico:** Atualizado somente pós-partida com base no **resultado (Win/Loss)** e **performance (Goals, Assists, Own Goals)**.
- *Nota sobre Assistências*: A API nativa do HaxBall não avisa quem efetuou ou quem chutou. O sistema trabalha baseando o status do chute guardando de memória quem foi o penúltimo do respectivo time da bolada!
  
---

## Mapa

Usa o **Futsal x3 by Bazinga** via `setCustomStadium()`. Idealizado para 3v3 sem paredões de gol (teto liso).

---

## Notas Técnicas

### Assincronicidade da API
Todos os métodos que mudam estado (`setPlayerTeam`, `setPlayerAdmin`, `startGame`, `stopGame`) são **assíncronos**. O bot usa `setTimeout()` antes de chamar esses métodos após `onPlayerJoin`, evitando ler estado desatualizado via `getPlayerList()`.

### Identificação de Jogadores
`player.auth` (disponível **apenas** em `onPlayerJoin`) é capturado e armazenado como `auth_key` em `user_info`. É o único identificador confiável para vincular sessões ao banco.

### Arquitetura Bridge
O bot roda em Node.js mas a API HaxBall executa no browser (Chromium via Puppeteer). A comunicação é via `page.exposeFunction()` (browser → Node.js) e `page.evaluate()` (Node.js → browser).

---

## Roadmap Futuro

- [ ] Autenticação real via site próprio
- [ ] Integração com pagar.me para recargas
- [ ] Loja web
- [ ] Sistema de ranking
- [ ] Inventário e cosméticos
- [ ] Sistema VIP com benefícios avançados
