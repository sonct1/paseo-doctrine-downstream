# Third-party source

`source-archives/beads-1.1.2.tar.gz` is the exact Beads 1.1.2 source archive supplied for this build.
It is retained in-tree so release Docker builds do not fetch Beads application source from GitHub.
The archive contains upstream `LICENSE` and `THIRD_PARTY_LICENSES`; Docker copies the license from the
verified extracted build stage.

`BEADS_SOURCE_SHA256.txt` records the SHA-256 of the supplied source tarball.
