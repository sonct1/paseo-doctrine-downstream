# Bind role instruction vào Paseo

Version: `3.2.0-topology-recovery`
Trạng thái: current source contract; original migration không activation, current local activation được ghi tại `CURRENT_DECISIONS.md`

## Layer boundary

| Layer | Chứa | Không chứa |
|---|---|---|
| Standing role profile | identity, universal authority boundary, anti-pattern guards | project routing/risk matrix, task file list |
| `WORKSPACE_PROTOCOL.md` | repo-specific delta về risk, topology, ownership, routing default, review/evidence và exceptions | universal role laws, `AGENTS.md`, one-task lease |
| Assignment | objective, disposition, mutation boundary, bounded routing/effort override, evidence, handback, stop | toàn bộ organization manual |

Full `WORKSPACE_PROTOCOL.md` chỉ được bind cho Lead. Supervisor chỉ inspect/create/audit/update khi governance assignment yêu cầu; Peer nhận extracted constraints và không load full protocol.

Standing profile giữ cross-repo identity cùng provider/model/effort default. Khi task cần route khác,
assignment phải ghi exact override, reason, `applies_to` và expiry; Lead enact nó khi tạo Peer. Override
hết hiệu lực ở handback/stop, không sửa standing profile và không tự áp cho assignment kế tiếp.

Khi repository chưa có valid root protocol, ordinary Lead → Peer engineering orchestration fail
closed. Exception không tạo layer mới: Supervisor có exact Human governance/bootstrap mandate có
thể interview Human và create/audit protocol candidate; Human hoặc explicitly authorized
repository owner apply/activate. Xem [Portable bootstrap và routing](PORTABLE_BOOTSTRAP_AND_ROUTING.md).

Standing role profile phải được bind qua một role-bound transport. Khi canonical transport đã tồn tại,
không thay bằng generic provider chỉ vì cùng model. Generic provider với một assignment tốt vẫn
không chứng minh canonical role profile đã được load. Nếu required role transport unavailable, giữ
route là `UNKNOWN`/blocked và xin ruling thay vì bypass profile layer.

Catalog/model discovery cũng không chứng minh standing profile đã bind. OpenCode candidate phải pin
custom primary agent khớp `paseo-lead|paseo-peer|paseo-supervisor` qua process-local
`OPENCODE_CONFIG_CONTENT` và matching `default_agent`; current OpenCode runtime không nhận tên custom
agent qua `modeId`, nên route phải omit field này. Generic provider alias vẫn `UNKNOWN` cho tới
provider-specific transport và fresh canary. Không silent fallback.

## Activation record

Mỗi session phải pin đủ:

```text
project/workspace + human-readable title:
role/disposition:
Lead-of-record hoặc Supervisor binding:
authority lease:
runtime capability/mode:
write-owner | no-write boundary:
external-side-effect boundary:
Supervisor recovery/replacement authority:
objective/evidence/handback/stop condition:
```

`full-access` là runtime capability chung, không phải assignment. Nếu mutation boundary thiếu hoặc mâu thuẫn, agent dừng trước incompatible work và gửi structured request.

## Workspace title transport

Native `create_workspace` nhận `title`; native `rename_workspace` đổi user-visible title. Creator đặt title theo objective. Lead chỉ rename workspace mình khi title generic và phải làm trước first delegation. Supervisor không rename Lead workspace.

## Codex transport

Mọi launchable/generated role profile bắt buộc có:

```toml
[features]
multi_agent = false
multi_agent_v2 = false

[agents]
enabled = false
```

Launcher phải fail closed nếu guard thiếu hoặc sai. Prompt restraint không thay kill switches. Caller
không được thêm profile khác hoặc override standing instruction, native-agent guards hay exact custom
provider route. Bounded assignment vẫn có thể override `model` và `model_reasoning_effort`; hai giá trị
này không cấp authority và hết hiệu lực cùng assignment. Custom Responses endpoint và command-backed
auth là supported transport choice khi exact provider binding được giữ. Role profile có thể chạy trên
`full-access`, nhưng mutation authority vẫn đến từ assignment.

## Provider-native role sources

Repository giữ model-neutral role source cho Lead, Peer và Supervisor dưới `profiles/claude/`,
`profiles/opencode/`, `profiles/antigravity/`, `profiles/omp/` và `profiles/cursor/`. Human chọn/pin Lead;
Lead chọn/pin provider/model cho từng Peer session; Human chọn/authorize Supervisor. Provider-native
source chỉ giữ standing contract, không cấp lease, activation, qualification hoặc authority chọn role.

Claude source deny native delegation bằng `disallowedTools`. Antigravity source đặt
`mainAgent: true`, `subagent: false`; generic ACP command chạy
`agy-acp --agy-binary scripts/antigravity-role`, rồi wrapper chỉ pin role từ exact allowlist,
preserve bridge argv và exec `agy --agent paseo-<role>`. Wrapper không phải ACP adapter. Cursor dùng
ba plugin root độc lập với một `alwaysApply` rule cho mỗi role, không dùng custom subagents. OMP dùng
`scripts/omp-role` để append exact role source, giữ process-local config deny native `task` và áp
explicit built-in tool allowlist loại cả `task` lẫn `hub`, không tạo isolated auth profile. Cursor source đúng documented
plugin shape nhưng Peer marker canary đã fail ở direct CLI và exact ACP, nên route đó blocked; Antigravity còn
`UNKNOWN`. Fresh Paseo canary vẫn cần cho activation và task-class qualification. Observation của một
role/provider không tự qualify hai role còn lại.

## OpenCode candidate transport

Ba OpenCode config dưới `profiles/opencode/` là repository candidates. Mỗi config chỉ expose đúng
một custom primary agent, có matching `default_agent`, không pin model và deny `permission.task`.
Paseo session route dùng process-local `launchContext.env.OPENCODE_CONFIG_CONTENT` để tạo dedicated
server, rồi omit `modeId` để OpenCode chọn matching `default_agent`. Không tạo ba global derived providers: normal settings của installed
`OpenCodeServerManager` có thể singleton-scoped và giữ command/runtime đầu tiên. Không đưa source vào
argv, không mutate global config/runtime. Bounded micro skill vẫn theo assignment lease và không tạo
orchestration authority. Activation và fresh canary là boundary riêng.

## Removed permission program

Foundation không còn execution classes `strict-read-only`, `supervisor-governance` hoặc `reviewer-full-temporary`; không giữ `TD-REV-001`. Không phát triển `defaultModeId`, elicitation heuristics hoặc Supervisor-specific MCP projection cho Foundation.

Room/Council boundary đã được Human accept tại [ADR-001](ROOM_COUNCIL_DESIGN_HANDOFF.md). Room vẫn là Paseo product capability độc lập; ADR acceptance không phải runtime qualification và không thay role authority.

## Migration/activation boundary

Files dưới `profiles/` là canonical source. Original migration không đổi user symlinks, provider config hoặc daemon; Human-authorized activation sau đó được ghi tại `CURRENT_DECISIONS.md`. Mỗi activation vẫn phải preview exact owned paths, preserve foreign paths, validate kill switches và có rollback. Không ngầm coi repository source validation là runtime qualification.

Generated runtime home/effective config là disposable projection, không phải role source mới. Mọi
materializer phải derive từ exact versioned canonical profile, record distribution/profile identity và
fresh-read effective config, role marker, native-delegation guard cùng tool inventory. Shared auth,
`AGENTS.md`, hooks, skills, plugins hoặc MCP chỉ được inherit khi install binding nêu source/owner và
`doctor` xác nhận effective boundary. Không embed một bản standing prompt độc lập, silently thêm
orchestration surface hoặc tự tạo Supervisor Notebook ngoài exact Control Workspace binding; mismatch
giữ activation/route `UNKNOWN/BLOCKED`.
