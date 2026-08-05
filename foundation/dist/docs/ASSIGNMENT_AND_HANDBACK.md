# Assignment và Handback tối thiểu

Template này là guard nhỏ, không phải checklist bắt buộc cho mọi câu trả lời.

## Assignment

```text
Workspace: <id/path>
Workspace title: <short objective-shaped title>
Role: <Lead | Peer | Supervisor>
Disposition: <Engineer/Owner | Solution Architect | Reviewer | Scout | Shadow | n/a>
Objective: <observable outcome>
Known facts: <verified only>
Unknowns: <material unknowns>
Mutation boundary: <write-owner exact scope | no-write>
Excluded scope: <paths/contracts/effects>
External effects: <none | exact authority>
Supervisor recovery/replacement authority: <none | exact bounded lease>
Routing/effort override: <none | exact provider/model/effort + reason + applies_to + expiry>
Stable candidate / input: <identity when applicable>
Verification: <proportional commands/evidence>
Escalate: <REOPEN | DEPENDENCY | BLOCKED | COUNCIL conditions>
Handback: <artifact, evidence, risks, lease state>
Stop: <completion or blocker condition>
```

Không nhét preferred implementation vào objective. File list và plan là provisional trừ khi chúng là exact ownership boundary. Override hết hiệu lực khi assignment handback/stop, không sửa standing role profile hoặc tự truyền sang task khác.

## Handback

```text
Outcome: <complete | partial | blocked | reopen requested>
Snapshot/candidate: <Git identity or exact bounded identity>
Changed/inspected scope: <paths>
Personally observed verification: <commands/results>
Failures/skips: <truthful list>
Counterevidence/unknowns: <material only>
Residual risks/Human decisions: <if any>
Ownership/lease: <released | retained with reason>
```

Status hoặc “tests pass” không tự là acceptance. Lead inspect stable artifact và issue engineering verdict; Human giữ decision ngoài Lead lease.
