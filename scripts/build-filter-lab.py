import argparse
import plistlib
import re
import shutil
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory


HOST_ID = "com.cacontrol.macos.filterlab"
FILTER_ID = HOST_ID + ".filter"
APP_NAME = "CA Control Filter Lab"
NETWORK = "com.apple.developer.networking.networkextension"
INSTALL = "com.apple.developer.system-extension.install"
CONTENT_FILTER = "content-filter-provider-systemextension"


def signed_entitlements(profile, bundle_id, host=False):
    teams = profile.get("TeamIdentifier", [])
    capabilities = profile.get("Entitlements", {})
    if len(teams) != 1 or not re.fullmatch(r"[A-Z0-9]{10}", teams[0]):
        raise ValueError(f"Expected one Developer Team in profile for {bundle_id}")
    team = teams[0]
    app_key = "com.apple.application-identifier"
    team_key = "com.apple.developer.team-identifier"
    if (capabilities.get(app_key) != f"{team}.{bundle_id}"
            or capabilities.get(team_key) != team
            or CONTENT_FILTER not in capabilities.get(NETWORK, [])):
        raise ValueError(f"Profile does not authorize Content Filter for {bundle_id}")
    if host and capabilities.get(INSTALL) is not True:
        raise ValueError("Host profile does not authorize system-extension installation")
    entitlements = {app_key: capabilities[app_key], team_key: team, NETWORK: [CONTENT_FILTER]}
    if host:
        entitlements[INSTALL] = True
    return team, entitlements


def info(bundle_id, executable, kind):
    return {
        "CFBundleIdentifier": bundle_id, "CFBundleExecutable": executable,
        "CFBundleName": APP_NAME, "CFBundlePackageType": kind,
        "CFBundleVersion": "1", "CFBundleShortVersionString": "0.1.0",
        "LSMinimumSystemVersion": "12.0",
        "NSSystemExtensionUsageDescription": "Filter Claude network connections in the macOS lab.",
    }


def run(*args):
    subprocess.run(args, check=True)


def decode(path):
    data = subprocess.check_output(("/usr/bin/security", "cms", "-D", "-i", str(path)))
    return plistlib.loads(data)


def plist(path, values):
    with path.open("wb") as stream:
        plistlib.dump(values, stream)


def compile_universal(output, staging, build):
    archs = ("arm64", "x86_64")
    parts = []
    for architecture in archs:
        part = staging / f"{output.name}-{architecture}"
        build(architecture, part)
        parts.append(str(part))
    run("/usr/bin/xcrun", "lipo", "-create", *parts, "-output", str(output))
    run("/usr/bin/xcrun", "lipo", "-verify_arch", *archs, str(output))


def build(args):
    project = Path(__file__).resolve().parents[1]
    native = project / "native" / "filter"
    team, host_entitlements = signed_entitlements(decode(args.host_profile), HOST_ID, host=True)
    filter_team, filter_entitlements = signed_entitlements(decode(args.filter_profile), FILTER_ID)
    if team != filter_team:
        raise ValueError("Host and filter profiles must belong to the same Developer Team")

    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    final_bundle = output / (APP_NAME + ".app")
    if final_bundle.exists():
        raise ValueError("Destination already contains a lab app. Choose a fresh output directory.")

    with TemporaryDirectory(prefix="ca-filter-lab-", dir=output) as temp:
        stage = Path(temp)
        app = stage / final_bundle.name
        extension = app / "Contents" / "Library" / "SystemExtensions" / (FILTER_ID + ".systemextension")
        host_exe = app / "Contents" / "MacOS" / "ca-filter-lab"
        filter_exe = extension / "Contents" / "MacOS" / "ca-filter-provider"
        filter_exe.parent.mkdir(parents=True)
        host_exe.parent.mkdir()
        plist(app / "Contents" / "Info.plist", info(HOST_ID, host_exe.name, "APPL"))
        filter_info = info(FILTER_ID, filter_exe.name, "SYSX")
        filter_info["NetworkExtension"] = {
            "NEMachServiceName": f"{team}.{FILTER_ID}",
            "NEProviderClasses": {"com.apple.networkextension.filter-data": "CAFilterProvider"},
        }
        plist(extension / "Contents" / "Info.plist", filter_info)

        compile_universal(host_exe, stage, lambda arch, dest: run(
            "/usr/bin/xcrun", "swiftc", "-swift-version", "5", "-target", f"{arch}-apple-macos12.0",
            str(native / "lab-controller.swift"), "-o", str(dest),
        ))
        compile_universal(filter_exe, stage, lambda arch, dest: run(
            "/usr/bin/xcrun", "clang", "-arch", arch, "-mmacosx-version-min=12.0", "-fobjc-arc", "-fblocks",
            "-Werror=unguarded-availability", "-framework", "Foundation", "-framework", "NetworkExtension",
            "-framework", "Security", str(native / "CAFilterProvider.m"), str(native / "policy.c"), "-o", str(dest),
        ))
        for bundle, profile, values in ((extension, args.filter_profile, filter_entitlements), (app, args.host_profile, host_entitlements)):
            shutil.copyfile(profile, bundle / "Contents" / "embedded.provisionprofile")
            entitlement_file = stage / (bundle.suffix + ".plist")
            plist(entitlement_file, values)
            run("/usr/bin/codesign", "--sign", args.identity, "--timestamp", "--options", "runtime",
                "--entitlements", str(entitlement_file), str(bundle))
        run("/usr/bin/codesign", "--verify", "--deep", "--strict", str(app))
        app.rename(final_bundle)
    print(final_bundle)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build a signed filter lab app without installing the extension.")
    parser.add_argument("--identity", required=True, help="Developer ID Application signing identity")
    parser.add_argument("--host-profile", required=True, type=Path)
    parser.add_argument("--filter-profile", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    cli = parser.parse_args()
    if sys.platform != "darwin":
        parser.error("The native filter lab requires macOS and Xcode Command Line Tools.")
    try:
        build(cli)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"{error}\n")
