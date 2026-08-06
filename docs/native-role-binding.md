# ADR — Native Role Binding trong Paseo

Trạng thái: accepted by Human; Codex/Claude/Pi/OMP/Cursor/Antigravity implementation và focused qualification gates hoàn tất trong current branch
Ngày: `2026-08-06`
Foundation contract: `ROLE_CONTRACTS 3.2.0-topology-recovery`

## Quyết định

`Lead`, `Peer` và `Supervisor` trở thành Foundation roles native của Paseo. Role không còn được biểu diễn bằng ba provider alias hoặc ba bản cấu hình thủ công cho từng provider.

Một agent được tạo từ bốn layer độc lập, sau đó được compose thành một launch contract bất biến:

```text
RoleDefinition + Provider + Workspace Protocol + Assignment
```

- `RoleDefinition` giữ identity, universal authority boundary và anti-pattern guards.
- `Provider` chỉ giữ transport, credentials, endpoint, model catalog và runtime capability.
- `WORKSPACE_PROTOCOL.md` vẫn là source do repository sở hữu; Paseo quản lý path, digest, validation state và readership.
- `Assignment` giữ bounded objective, disposition, lease, scope, evidence, handback và stop condition.

## Vì sao không dùng initial prompt

Role phải đi qua provider-native durable instruction channel để còn hiệu lực sau compact, resume và turn mới. Initial user prompt, label hoặc convention không đủ làm standing authority boundary.

Daemon materialize role đã chọn thành một immutable `RoleBinding`. Binding chứa exact instruction bytes và public receipt:

```text
roleId
definitionVersion
definitionDigest
bindingDigest
provider
injectionMethod
qualification (`implementation-supported`; runtime acceptance evidence được record riêng)
createdAt
```

Client chỉ gửi `roleId`; client không gửi hoặc sửa materialized instruction. Resume/reload phải dùng exact persisted binding, không resolve lại từ catalog hiện tại và không nhận role/system-prompt override.

Ngay trước launch, daemon compose `RoleBinding` với exact provider route thành một immutable
`LaunchContract`. Contract pin `roleId`, logical `providerId`, provider family, model,
`model_provider`, auth method, credential readiness và exact internal route bytes. Agent đã bind không đổi
model tại chỗ; muốn đổi role/provider/model phải spawn agent mới. Public snapshot, MCP create result và
`paseo agent inspect` chỉ trả secret-safe receipt cùng `credentialConfigured`, không trả base URL,
`credentialRef`, credential-file path hoặc secret.

Role catalog là một registry provider-neutral do Paseo sở hữu, pin `ROLE_CONTRACTS` version và doctrine precedence `Human → Deep Dive → Role Contract/Workspace Protocol → current evidence`; Giáo Án Herdr là extended historical evidence, không override source hiện hành. Đây là một catalog chung, không phải ba bản role config nhân với từng provider. `definitionDigest` làm drift visible; thay standing bytes phải đi cùng contract/version decision mới.

## Provider capability

Role và provider chỉ ghép được khi adapter có native durable instruction channel đã khai báo rõ:

- Codex: `developerInstructions` trên thread start/resume và từng turn; đồng thời khóa native delegation bằng `multi_agent=false`, `multi_agent_v2=false`, `agents.enabled=false`.
- Claude: Agent SDK `systemPrompt` append; đồng thời deny native delegation tools sau khi merge provider extras.
- Pi append exact binding bằng generated `before_agent_start` extension trên create/resume.
- OMP append exact binding bằng native `--append-system-prompt` trên create/resume.
- Cursor ACP materialize một stable private role capsule dưới Paseo state, ghi exact binding vào `.cursor/rules/paseo-role.mdc` với `alwaysApply: true`, rồi launch `cursor-agent --workspace <capsule> --add-dir <repo> acp`. Caller-supplied `--workspace` bị reject. Không dùng `--plugin-dir`: installed runtime đã chứng minh local plugin có thể bị silent-ignore. Exact direct marker, repo-access, ACP create và ACP resume canary đều pass trên `cursor-agent 2026.08.04-aaa8809`.
- Antigravity ACP materialize một unique per-agent custom-agent profile và exact wrapper pin `agy --agent`; profile được create/verify/cleanup theo exact bytes. Official `agy` custom-agent registration, marker và resume canary pass; wrapper args cho discovery/prompt/resume và caller `--agent` override có focused executable tests. Driver chạy trên macOS/Linux. Live `agy models` là provider-catalog diagnostic riêng và có thể timeout độc lập với role binding.
- Generic ACP không có standardized system-instruction field nên mặc định `unsupported`. Paseo chỉ auto-detect hai exact transport shape trên; custom ACP khác phải có provider-native driver riêng và qualification evidence trước khi được chọn cho role-bound spawn.

Capability có ba trạng thái: `supported` được role-first picker sử dụng; `candidate` dành cho exact implementation method còn thiếu runtime gate; `unsupported` không có native durable channel hoặc launch shape không hợp lệ. Candidate không được fallback sang initial prompt hoặc generic ACP. Cursor và Antigravity hiện là `supported`; legacy `cursor-plugin` fail closed với migration notice.

`agy-acp` là third-party transport. Technical role support không thay user-account policy: provider detail phải hiện notice yêu cầu review current [Google Antigravity authentication terms](https://antigravity.google/terms). Qualification trong branch dùng official `agy` cho model calls và fake binary cho bridge pinning, không dùng OAuth account qua third-party bridge.

Không có silent fallback. Provider có model phù hợp nhưng thiếu native role channel vẫn không tương thích với Foundation role.

### Hai Codex route độc lập với role

- Built-in `codex` là Codex native subscription. Preflight gọi app-server `account/read`, chỉ nhận
  `account.type=chatgpt`, pin `model_provider=openai`, giữ Codex auth store mặc định (`auth.json` hoặc OS
  keyring) và scrub ambient OpenAI API-key/base-URL variables khỏi role-bound process.
- Custom OpenAI-compatible Codex là một logical provider `extends: "codex"` có exact model catalog,
  `OPENAI_BASE_URL` non-secret và `credentialRef`. Daemon materialize exact custom `model_provider`, HTTPS
  `/v1` base URL và Codex command-backed auth đọc private credential projection. Thiếu explicit model, URL,
  credential ref hoặc configured key đều fail trước provider launch.

Custom route không fallback sang subscription khi preflight hoặc launch lỗi. Catalog custom cũng không kế
thừa model catalog của subscription. Hai route dùng chung Codex binary nhưng không dùng chung credential:
subscription giữ Codex auth store; custom dùng private Paseo credential store. Không tạo provider-specific
`CODEX_HOME` chỉ để tách API key; chỉ cần `CODEX_HOME` riêng nếu Human thật sự muốn hai Codex login store độc
lập.

## Tool policy và authority

Role-bound session lấy tool enablement từ role; `paseoTools.enabled` chỉ là default cho session không
bind role. Provider `allowedTools` hoặc `disabledTools` vẫn có thể thu hẹp catalog của Lead và
Supervisor nhưng không thể mở rộng role authority. Global `daemon.mcp.injectIntoAgents=false` vẫn tắt
toàn bộ projection.

- Lead có Paseo delegation/lifecycle tools trong Human lease.
- Peer không có orchestration tools.
- Supervisor chỉ có observation/governance subset; recovery/replacement vẫn cần exact Human lease.

`full-access` là runtime capability, không phải write lease, ownership, external-effect hoặc acceptance authority.

## Workspace Protocol

Paseo không copy protocol vào global config. Repository tiếp tục sở hữu bytes tại root. Paseo ghi nhận:

- resolved path;
- content digest và binding state (`bound|missing`; chưa claim semantic validation);
- role-specific readership;
- receipt của lần bind.

Lead được bind full protocol trước orchestration. Peer không đọc full protocol và chỉ nhận relevant constraints trong assignment. Supervisor chỉ được bind full protocol khi governance assignment yêu cầu create/audit/update.

## UX

Create flow đi theo thứ tự:

1. tạo/chọn workspace;
2. chọn role;
3. hiển thị authority summary và protocol requirement;
4. chọn một provider tương thích;
5. chọn model/mode và preview binding receipt;
6. nhập assignment rồi spawn.

Provider Settings chỉ cấu hình connection/credentials/model. Foundation Roles hiển thị role contract version, compatible providers, injection method và qualification state. Provider detail hiển thị native method, policy notice hoặc candidate blocker; role-first picker chỉ liệt kê `supported`. Cursor và exact `agy-acp --agy-binary <agy>` được nhận diện từ transport command nên catalog/config không cần ghi `roleBinding` thủ công. Các provider alias như `codex-lead` là migration input, không phải product model mới.

Trong migration window, daemon nhận diện **exact legacy wrapper command** như `codex-profile <role>`, `codex-cliproxy-profile <role>` hoặc `claude --agent paseo-<role>`. Các route này bị loại khỏi native role-first picker và bị reject trước state mutation/session launch; Paseo không suy role từ provider ID tùy ý. Transport-only alias kế thừa Codex/Claude vẫn tương thích.

## Migration

Rollout theo vertical slices:

1. protocol schema, daemon registry, immutable receipt và inspect/readback;
2. Codex + Claude native injection và adversarial resume/reload tests;
3. role-first WebUI và CLI `--role`;
4. compose và persist immutable role/provider/model launch contract;
5. compatibility mapping cho legacy aliases với warning, không infer role từ arbitrary provider name;
6. Pi/OMP/Cursor/Antigravity native driver, exact qualification và transport-policy notice;
7. xóa generated per-role provider aliases sau migration window.

Không restart daemon hoặc mutate user credentials/provider activation trong implementation. Focused direct/ACP canary dùng installed native CLIs nhưng không đổi daemon activation; fresh daemon readback vẫn là release/activation gate riêng.

## Acceptance gates

- Raw create request không thể materialize hoặc override role instruction.
- Role-bound session không nhận `systemPrompt` từ caller.
- Resume/reload giữ exact role bytes và digest đã persist.
- Resume/reload giữ exact provider route và model; model mutation trên role-bound agent bị reject.
- Codex/Claude provider extras không thể ghi đè role instruction hoặc native-delegation guards.
- Built-in Codex chỉ launch khi native account readback là ChatGPT subscription.
- Custom Codex thiếu model/URL/key hoặc launch lỗi không fallback sang built-in subscription.
- Snapshot, MCP create result và `paseo agent inspect` hiển thị effective `roleId`, `providerId`, `model` và
  `credentialConfigured` nhưng không expose instruction hoặc secret-bearing route bytes.
- Incompatible provider bị reject trước session launch.
- Cursor capsule phải giữ exact role marker qua ACP create/resume mà không ghi `.cursor/rules` vào target repository.
- Antigravity wrapper phải pin exact materialized agent trên discovery/prompt/resume, reject caller `--agent`, cleanup only exact owned profile, và hiện third-party auth notice.
- Legacy no-role sessions tiếp tục chạy như trước.
