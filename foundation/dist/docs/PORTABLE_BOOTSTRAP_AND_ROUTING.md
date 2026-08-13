# Mandatory protocol bootstrap và routing status

Trạng thái: repository candidate; activation/qualification theo từng route
Runtime snapshots: Paseo `0.2.5`; OpenCode `1.18.12`; OMP `17.2.1`;
Cursor Agent `2026.07.23-e383d2b`; Antigravity `1.1.10`; observed `2026-08-04`

## Ba instruction layers

Foundation giữ đúng ba layer:

1. standing role profile chứa identity và universal authority boundary;
2. mandatory root `WORKSPACE_PROTOCOL.md` giữ fixed Beads Central invariant và thin repository tactics;
3. bounded assignment chứa objective, disposition, lease, route, evidence, handback và stop.

Repository không có material tactics riêng vẫn cần layer 2 vì issue tracker là protocol invariant;
authority vẫn đến từ Human/Lead assignment. Bootstrap chỉ tạo mandatory root artifact, không tạo
instruction layer thứ tư, không tự cấp authority và không biến validator thành acceptance engine.

Canonical template giữ chín repo-specific clauses cộng một fixed issue-tracker clause. Universal role invariants ở standing profile,
engineering convention ở `AGENTS.md`/Project Harness, còn one-task lease và provider/model/effort
route ở assignment. Không dùng line count cứng cho target repository; validator chỉ kiểm integrity của
file, v3 marker và mandatory tracker clause; không ép target theo wording của các repo-specific clauses.

## Bounded bootstrap

Admission là graduated theo [`D-033`](CURRENT_DECISIONS.md#d-033--graduated-admission-và-additive-protocol-schema).
Protocol được bind ở project onboarding: thiếu file thì sinh `baseline` form và ghi sau khi Human xác
nhận. Absence **không** block ordinary role launch — gate chỉ áp trước new material delegation hoặc
protected/mutating work. Invalid hoặc unreadable vẫn fail closed tới correction path và không bao giờ bị
ghi đè im lặng.

Schema version không tham gia vào quyết định chặn: checker chấp nhận mọi version đã phát hành và bỏ qua
clause lạ. Command sau kiểm nonempty, placeholder, conflict marker, supported marker, minimal identity và
mandatory Beads Central clause:

```bash
scripts/validate-foundation --check-protocol /path/to/repository
```

File absent hoặc invalid đều fail. Kết quả pass chỉ là byte validity, không phải semantic review, role
binding, assignment authority, engineering readiness hay acceptance. Supervisor chỉ create/audit file
khi có exact governance mandate và không self-approve. Bootstrap exception hết hiệu lực ở declared stop
hoặc expiry; ordinary work cần fresh valid binding.

## OpenCode role candidates

Ba inline config tại [`profiles/opencode/`](../profiles/opencode/) là role sources, không phải active
profiles. Với role đã được đúng authority chọn, session route phải:

```text
base provider: opencode
launchContext.env.OPENCODE_CONFIG_CONTENT: exact JSON content của <role>.config.json
launchContext.env.OPENCODE_CONFIG_DIR: <installed-release>/profiles/opencode-role-roots/<role>
session modeId: omitted
```

`launchContext.env` buộc OpenCode adapter tạo dedicated server với process-local environment.
`OPENCODE_CONFIG_DIR` trỏ vào generated role projection chỉ chứa skill được admission cho role đó;
không project Foundation role skill vào `~/.agents/skills`, `~/.claude/skills` hoặc global OpenCode
skill root. Không tạo ba global derived OpenCode providers: normal settings của installed
`OpenCodeServerManager` có thể singleton-scoped và giữ command/runtime đầu tiên; có
`launchContext.env` mới buộc dedicated server. Không đặt JSON/profile trong command arguments,
không ghi global OpenCode config, không install, không restart daemon và không claim activation.
Mỗi inline config expose đúng một custom primary agent, đặt `default_agent` cùng tên và deny
`permission.task` để Paseo vẫn là delegation/lifecycle plane duy nhất. Standing profile không pin
model. Current OpenCode `1.18.12` chỉ expose session modes `build`/`plan`; gửi
`modeId=paseo-<role>` fail trước turn với invalid mode. Vì process-local config chỉ expose đúng một
custom primary agent và đặt matching `default_agent`, route phải omit `modeId`, rồi fresh canary xác
minh role marker. Missing/mismatched `default_agent` hoặc fallback warning là `UNKNOWN/BLOCKED`, không
silent fallback.

Không blanket-deny toàn bộ `permission.skill`: role config deny exact Foundation package không thuộc
bundle nhưng vẫn cho phép micro skill implementation/test/debug/research ngoài Foundation trong exact
assignment lease. Standing profile và assignment vẫn cấm orchestration skill/authority; isolated
role root cộng exact permission map là technical discovery boundary cho Foundation package.

Paseo `0.2.5` CLI `--env` đi vào `launchContext.env`; generic ACP `session/new` và `prompt` vẫn không
transport `systemPrompt`. Provider wiring, activation và fresh canary là Human-authorized work riêng.

## Provider-native role-source candidates

Repository có ba model-neutral role sources cho mỗi provider:

| Provider | Source | Candidate route | Evidence hiện tại |
|---|---|---|---|
| Claude | `profiles/claude/paseo-<role>.md` + generated `profiles/claude-plugins/paseo-<role>/` | provider override chạy Claude với exact `--plugin-dir` và `--agent paseo-<role>` sau authorized source activation | role source có prior evidence; generated skill projection vẫn cần fresh role-visible canary |
| Antigravity | `profiles/antigravity/agents/paseo-<role>/agent.md` | generic ACP override chạy `agy-acp --agy-binary scripts/antigravity-role`; wrapper pin `agy --agent paseo-<role>` từ exact env allowlist | static source/wrapper pass; discovery/auth canary không đủ sạch, giữ `UNKNOWN` |
| OMP | `profiles/omp/paseo-<role>.md` + shared `role.config.yml` | derived `omp` provider chạy `scripts/omp-role <role>`; wrapper append prompt, pin built-in tool allowlist không có `task`/`hub`, deny prompt/config/tool override, rồi OMP adapter append model/mode | direct RPC marker pass; `9router/deepseek-v4-flash` Peer marker + allowlist canary pass; fresh isolated Paseo role-catalog readback pass với `task`/`hub` absent |
| Cursor | `profiles/cursor/paseo-<role>/` | `cursor-agent --plugin-dir <absolute-role-plugin> acp` | manifest/rule static pass nhưng Peer marker fail ở direct CLI và exact ACP; `BLOCKED_CURRENT_RUNTIME` |

Portable shape nằm tại
[`templates/paseo-provider-overrides.example.json`](../templates/paseo-provider-overrides.example.json).
Mọi alias trong example đều `enabled=false`. Các `{{REQUIRED_ABSOLUTE_PATH: ...}}` phải được
Human/authorized owner resolve và route được qualify trước khi bật từng alias.
Template không chứa OpenCode global override vì OpenCode dùng per-session inline env + matching
`default_agent` và omit custom mode.
Nó cũng không install/copy role source, pin model, giữ credentials hoặc chứng minh activation.

Antigravity transport chain chính xác là:

```text
Paseo generic ACP -> agy-acp -> antigravity-role -> agy --agent paseo-<role>
```

`agy-acp` là ACP stdio adapter. `antigravity-role` không phải ACP adapter; nó chỉ là executable được
truyền qua `--agy-binary`, fail closed trên role/binary/`--agent` conflict, rồi exec exact `agy` với
role đã pin. Override giữ capability boundary đã biết của bridge:
`supportsMcpServers=false`, `clientCapabilities.fs.readTextFile=false`,
`clientCapabilities.fs.writeTextFile=false` và `clientCapabilities.terminal=false`.

[Antigravity custom-agent docs](https://antigravity.google/docs/cli/commands/agents) dùng
`.agents/agents/<name>/agent.md`; [changelog](https://antigravity.google/changelog) hỗ trợ
`mainAgent`/`subagent`, và candidate đặt
`mainAgent: true`, `subagent: false` để giữ source ở primary role. [Cursor plugin
reference](https://cursor.com/docs/reference/plugins) dùng `.cursor-plugin/plugin.json` và
auto-discovered `rules/*.mdc`; [Cursor rules](https://cursor.com/docs/rules) định nghĩa
`alwaysApply: true` là static intent. Installed Cursor Agent `2026.07.23-e383d2b` không đưa marker của
Peer rule vào direct `--plugin-dir` hoặc exact ACP canary, kể cả khi manifest nêu explicit rule path;
ACP vẫn expose 33 models nhưng trả `role=absent; contract=absent`. Vì vậy Cursor route fail closed thay
vì dùng project/user rule chung. Không dùng Cursor custom subagents.

[OMP context docs](https://github.com/can1357/oh-my-pi/blob/main/docs/context-files.md) xác nhận native
role/context injection; [OMP settings](https://github.com/can1357/oh-my-pi/blob/main/docs/settings.md)
xác nhận process-local `--config`, per-tool deny và profile isolation. Foundation không dùng named
OMP profile vì nó isolate auth/session/settings; wrapper append exact role prompt, config overlay và
built-in tool allowlist chỉ cho process hiện tại. OMP source định nghĩa `task` là subagent fan-out và
`hub` là live-agent messaging/job-process supervision; explicit tool-name restriction là boundary nhỏ
nhất loại hai native coordination surfaces mà vẫn giữ micro engineering tools.

Upstream Paseo source được inspect tại ignored clone commit
`74dea384566dee6e5458c107191c13bdc16b9960`: provider override schema không có default
`systemPrompt`; direct adapters có provider-specific system-prompt mapping nhưng generic ACP
`session/new` không transport field đó. Suy ra role source phải đi bằng native profile/flag/wrapper;
đây là adapter boundary, không phải instruction layer thứ tư.

Authority chọn route không nằm trong source: Human chọn/pin Lead; Lead chọn/pin provider/model của
từng Peer; Human chọn/authorize Supervisor. Paseo vẫn là control plane duy nhất.

## Routing evidence, không ranking

Không có universal total model ranking. Lead chọn trong các route role-bound hiện available bằng
task risk, benchmark evidence như hint, local representative qualification và exact data/retention
policy. Không fallback im lặng.

Human chọn và pin Lead; Lead chọn và pin provider/model cho từng Peer sau availability/risk/
qualification checks. Human, không phải Lead, chọn và authorize Supervisor.

| Transport/provider | Catalog | Role binding | Task-class qualification | Constraint hiện biết |
|---|---|---|---|---|
| `codex-peer` | observed | qualified transport observed | route-specific evidence required | canonical role-bound transport |
| `codex-<role>-cliproxy` | observed | Lead/Peer/Supervisor exact role markers observed; Lead/Supervisor read-only catalog calls và Peer no-catalog boundary observed | route-specific evidence required | local `responses` overlay dùng command-backed auth; activation file/path là machine-local |
| `claude-peer` | `claude-fable-5`, alias `claude-opus-5` observed | qualified transport observed | route-specific evidence required | Fable chỉ eligible khi data policy cho phép 30-day retention / NO-ZDR |
| OpenCode + `opencode-go/deepseek-v4-flash` | `OBSERVED` | Peer role marker observed với inline `default_agent`, no custom mode | `UNKNOWN` | Lead/Supervisor và task-class vẫn cần fresh canary |
| OMP | local catalog observed | DeepSeek V4 Flash marker pass; isolated Paseo Lead → Peer route pass | bounded write/test handback pass hẹp | first Paseo canary exposed native `task`/`hub`; wrapper allowlist correction và fresh Paseo no-write catalog readback đều pass |
| `gemini-antigravity` | 11 models observed | `ROLE_BINDING_CANDIDATE/UNKNOWN` | `UNKNOWN` | role source/wrapper chỉ là static candidate |
| `cursor` | 33 models observed | Peer direct CLI + exact ACP role-marker fail; Paseo route blocked | `UNKNOWN` | plugin source valid nhưng installed CLI không bind rule; model catalog không cure role failure |

Một exact run failure, nếu được freeze và reproduced, chỉ là observation của run đó; không tự
nâng thành provider-wide `FAIL/UNSTABLE`. Catalog availability không cấp role, authority hoặc
qualification.

### Bản đồ task-class, observed `2026-08-04`

| Task class | Routing hint có điều kiện | Direct evidence |
|---|---|---|
| long-horizon hoặc decision-sensitive | Sol hoặc role-qualified Fable; vẫn cần exact role transport, local qualification và Fable retention gate | OpenAI coding table: Sol `80 / 64.6 / 72.7 / 88.8` trên AA Coding Agent Index / SWE-Bench Pro / DeepSWE / Terminal-Bench; Anthropic định vị Fable cho ambitious, long-running work và yêu cầu 30-day retention |
| bounded/everyday | Luna hoặc Gemini 3.6 Flash; Gemini vẫn generic/unqualified tới khi có provider-specific role binding | Luna `74.6 / 62.7 / 67.2 / 84.7`; Gemini `58.7 / 49 / 78` trên ba benchmark coding tương ứng và official page nêu everyday tasks/agentic coding |
| scout/simple-agent/bounded | DeepSeek V4 Flash sau role binding + local task qualification | DeepSeek nêu reasoning gần V4 Pro, ngang simple Agent tasks, 1M context và ưu thế tốc độ/chi phí |
| independent falsification | route role-bound đủ mạnh và đủ độc lập để có thể đổi decision; không hard-code một model | Lead chọn theo risk và independence trên stable candidate |

Cursor alias `claude-opus-5` mới chỉ được observed trong provider catalog; official underlying
identity và comparable official benchmark qualification vẫn `UNKNOWN`.

Nguồn trực tiếp: [GPT-5.6](https://openai.com/index/gpt-5-6/),
[Gemini 3.6 Flash](https://deepmind.google/models/gemini/flash/),
[DeepSeek V4](https://api-docs.deepseek.com/news/news260424/),
[Claude Fable](https://www.anthropic.com/claude/fable), và
[SWE-Bench architecture study](https://arxiv.org/abs/2506.17208). Các số benchmark là snapshot
volatile của model + harness, không phải validator invariant, authority, qualification hoặc
universal ordering. Study cho thấy leaderboard submissions dùng cả agentic và non-agentic
architectures; local representative qualification vẫn quyết định route.

## Activation gate

Human-authorized activation phải preview exact provider/runtime delta, verify process-local env/path,
pin role theo đúng selection authority, chạy fresh canary kiểm role marker + readership boundary +
prohibited native delegation + assignment boundary + bounded micro-skill behavior, rồi giữ rollback.
Repository validation không thay activation hoặc Lead acceptance; candidate chưa được gọi broadly
reusable trước canary.
