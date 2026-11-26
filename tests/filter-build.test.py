import plistlib
import runpy
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


builder = runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts" / "build-filter-lab.py"))
scope = builder["build"].__globals__


def profile(bundle, team="ABCDE00000", install=False):
    return {
        "TeamIdentifier": [team],
        "Entitlements": {
            "com.apple.application-identifier": f"{team}.{bundle}",
            "com.apple.developer.team-identifier": team,
            builder["NETWORK"]: [builder["CONTENT_FILTER"]],
            builder["INSTALL"]: install,
        },
    }


class FilterBuildTest(unittest.TestCase):
    def test_requires_exact_bundle_and_host_permission(self):
        host = builder["HOST_ID"]
        entitlements = builder["signed_entitlements"]
        with self.assertRaises(ValueError):
            entitlements(profile(host), host, host=True)
        with self.assertRaises(ValueError):
            entitlements(profile(host + ".other", install=True), host, host=True)
        _, extension = entitlements(profile(builder["FILTER_ID"], install=True), builder["FILTER_ID"])
        self.assertNotIn(builder["INSTALL"], extension)

    def test_publication_requires_nested_signature_and_two_architectures(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            host_profile = directory / "host.provisionprofile"
            filter_profile = directory / "filter.provisionprofile"
            host_profile.write_bytes(b"host-profile-fixture")
            filter_profile.write_bytes(b"filter-profile-fixture")
            args = SimpleNamespace(host_profile=host_profile, filter_profile=filter_profile,
                                   output=directory / "output", identity="fixture-signing-identity")
            app = args.output / (builder["APP_NAME"] + ".app")
            profiles = {host_profile: profile(builder["HOST_ID"], install=True),
                        filter_profile: profile(builder["FILTER_ID"])}
            operations = []

            def execute(*command):
                operations.append(command)
                if "lipo" in command and "-create" in command:
                    Path(command[-1]).write_bytes(b"universal-binary-fixture")
                if "--verify" in command and reject_signature:
                    raise OSError("invalid fixture signature")

            with patch.dict(scope, decode=lambda path: profiles[path], run=execute):
                reject_signature = True
                with self.assertRaises(OSError):
                    scope["build"](args)
                self.assertFalse(app.exists())
                self.assertEqual(list(args.output.iterdir()), [])
                operations.clear()
                reject_signature = False
                scope["build"](args)
                with self.assertRaises(ValueError):
                    scope["build"](args)

            extension = app / "Contents" / "Library" / "SystemExtensions" / (builder["FILTER_ID"] + ".systemextension")
            config = plistlib.loads((extension / "Contents" / "Info.plist").read_bytes())
            self.assertEqual(config["CFBundleIdentifier"], builder["FILTER_ID"])
            self.assertEqual(config["NetworkExtension"]["NEProviderClasses"],
                             {"com.apple.networkextension.filter-data": "CAFilterProvider"})
            architecture_checks = [operation for operation in operations if "-verify_arch" in operation]
            self.assertEqual(len(architecture_checks), 2)
            self.assertTrue(all(operation[3:5] == ("arm64", "x86_64") for operation in architecture_checks))
            signatures = [operation[-1] for operation in operations if "--sign" in operation]
            self.assertTrue(signatures[0].endswith(".systemextension"))
            self.assertTrue(signatures[1].endswith(".app"))


if __name__ == "__main__":
    unittest.main()
