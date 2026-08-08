# Assignment và Handback tối thiểu

Assignment là one-task delta, không lặp standing role, full Workspace Protocol hoặc context mà
runtime đã bind. Chỉ giữ dữ kiện làm thay đổi authority, execution hoặc acceptance.

## Assignment

```text
Objective: <observable outcome>
Authority: <exact mutation owner/scope and external effects | no-write>
Evidence: <observable acceptance and proportional verification>
Handback/stop: <required artifact/state and completion or blocker condition>
```

Chỉ thêm khi material: exact workspace/role/disposition nếu runtime chưa bind rõ; excluded scope;
stable review input; material unknown/escalation condition; Supervisor recovery lease; hoặc bounded
`Routing/effort override` với exact provider/model/effort, reason, applies_to và expiry.

Không nhét preferred implementation vào objective. File list và plan là provisional trừ khi chúng là
exact ownership boundary. Override hết hiệu lực khi assignment handback/stop, không sửa standing role
profile hoặc tự truyền sang task khác.

## Handback

```text
Outcome: <complete | partial | blocked | reopen requested>
Snapshot/candidate: <Git identity or exact bounded identity>
Changed/inspected scope: <paths>
Verification/skips: <personally observed results and truthful omissions>
Unknowns/risks/Human decisions: <material only>
Ownership/lease: <released | retained with reason>
```

Status hoặc “tests pass” không tự là acceptance. Lead inspect stable artifact và issue engineering verdict; Human giữ decision ngoài Lead lease.

Paseo product materialize role-bound assignment thành immutable contract và redacted receipt theo
[Assignment Receipt và Supervisor Portfolio Binding](ASSIGNMENT_RECEIPT_AND_SUPERVISOR_PORTFOLIO.md).
Receipt bind exact bytes/boundaries nhưng không thay assignment, handback hoặc acceptance authority.
