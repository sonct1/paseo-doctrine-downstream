{
  lib,
  stdenv,
  buildGo126Module,
  fetchurl,
  makeWrapper,
  python3Packages,
  go_1_26,
}:

let
  lock = builtins.fromJSON (builtins.readFile ../components/beads-central.lock.json);
  centralSource = ../components/beads-central-src;
  sidecarEntrypoint = ../scripts/beads-central-sidecar-entry.py;

  # The lock stores the upstream archive digest in hexadecimal for the
  # host-native builder. Nix fetchers use the equivalent SRI representation.
  beadsSourceSha256 =
    assert lock.beadsSourceSha256 == "03ad2d43a97c75248ecfae28cad6789af506861c18568399c6e1432b02c1fe48";
    "sha256-A60tQ6l8dSSOz64oytZ4mvUGhhwYVoOZxuFDKwLB/kg=";

  beadsSource = fetchurl {
    url = lock.beadsSourceUrl;
    hash = beadsSourceSha256;
  };

  go1262 = go_1_26.overrideAttrs (_: {
    version = "1.26.2";
    src = fetchurl {
      url = "https://go.dev/dl/go1.26.2.src.tar.gz";
      hash = "sha256-LpHrtpR6lulDb7KzkmqIAu/mOm03Xf/sT4Kqnb1v1Ds=";
    };
  });

  bd = (buildGo126Module.override { go = go1262; }) {
    pname = "beads";
    version = lock.beadsVersion;
    src = beadsSource;

    vendorHash = "sha256-WWEwGpCwMPD7jaz02zN745RQQqYTQttehbcT3J9hayM=";
    subPackages = [ "cmd/bd" ];
    tags = [ "gms_pure_go" ];
    ldflags = [
      "-s"
      "-w"
      "-X"
      "main.Build=v${lock.beadsVersion}-bundled"
    ];
    doCheck = false;
  };

  pythonRuntime = python3Packages.python.withPackages (ps: with ps; [
    fastapi
    uvicorn
    pydantic
    pyyaml
  ]);
in
stdenv.mkDerivation {
  pname = "paseo-beads-central";
  version = lock.version;
  dontUnpack = true;
  dontBuild = true;

  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall

    mkdir -p $out/bin $out/lib/beads-central $out/share/licenses/beads-central
    cp -R ${centralSource}/beads_central $out/lib/beads-central/
    install -m 0555 ${sidecarEntrypoint} $out/lib/beads-central/entry.py

    makeWrapper ${pythonRuntime}/bin/python $out/bin/beads-central \
      --add-flags "$out/lib/beads-central/entry.py" \
      --set PYTHONPATH "$out/lib/beads-central"

    ln -s ${bd}/bin/bd $out/bin/bd

    install -m 0444 ${centralSource}/LICENSE \
      $out/share/licenses/beads-central/LICENSE
    install -m 0444 ${centralSource}/third_party/NOTICE.md \
      $out/share/licenses/beads-central/NOTICE.md
    install -m 0444 ${centralSource}/SOURCE_COMMIT \
      $out/share/licenses/beads-central/SOURCE_COMMIT
    install -m 0444 ${../components/beads-central.lock.json} \
      $out/share/licenses/beads-central/beads-central.lock.json

    runHook postInstall
  '';

  passthru = { inherit bd; };

  meta = {
    description = "Paseo's pinned Beads Central sidecar and bd runtime";
    homepage = "https://github.com/getpaseo/paseo";
    license = lib.licenses.mit;
    platforms = lib.platforms.unix;
  };
}
