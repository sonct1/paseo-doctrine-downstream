# Foundation distribution

`dist/` là generated, immutable runtime distribution được import từ exact tagged commit của
`paseo-foundation`. Không sửa file dưới `dist/` trong repository này.

`manifest.json` giữ version, source commit, mode và SHA-256 của từng file. `sources.lock.json` khóa
Foundation source cùng Paseo upstream base. Refresh bằng `scripts/import-foundation.mjs`, chỉ từ
Foundation worktree sạch.
