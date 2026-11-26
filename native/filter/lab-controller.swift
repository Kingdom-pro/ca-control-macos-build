import Foundation
import Dispatch
import NetworkExtension
import SystemExtensions

private let hostID = "com.cacontrol.macos.filterlab"
private let filterID = hostID + ".filter"

private enum Action: String {
    case status, enable, remove
}

private final class Controller: NSObject, OSSystemExtensionRequestDelegate {
    private let manager = NEFilterManager.shared()
    private let action: Action

    init(action: Action) {
        self.action = action
    }

    func start() {
        manager.loadFromPreferences { error in
            if let error { self.fail(error.localizedDescription) }
            if let config = self.manager.providerConfiguration,
               config.filterDataProviderBundleIdentifier != filterID {
                self.fail("Existing content filter belongs to another application.")
            }
            switch self.action {
            case .status:
                let configured = self.manager.providerConfiguration != nil
                print(configured ? (self.manager.isEnabled ? "configured and enabled" : "configured and disabled") : "not configured")
                exit(0)
            case .enable:
                self.submitActivation()
            case .remove:
                self.removePreferences()
            }
        }
    }

    private func submitActivation() {
        let request = OSSystemExtensionRequest.activationRequest(forExtensionWithIdentifier: filterID, queue: .main)
        request.delegate = self
        OSSystemExtensionManager.shared.submitRequest(request)
    }

    func requestNeedsUserApproval(_ request: OSSystemExtensionRequest) {
        print("Approve CA Control Filter Lab in System Settings to continue.")
        fflush(stdout)
    }

    func request(_ request: OSSystemExtensionRequest,
                 actionForReplacingExtension existing: OSSystemExtensionProperties,
                 withExtension replacement: OSSystemExtensionProperties) -> OSSystemExtensionRequest.ReplacementAction {
        .cancel
    }

    func request(_ request: OSSystemExtensionRequest, didFailWithError error: Error) {
        fail(error.localizedDescription)
    }

    func request(_ request: OSSystemExtensionRequest, didFinishWithResult result: OSSystemExtensionRequest.Result) {
        guard result == .completed else { fail("Extension activation requires a restart. Retry after rebooting the guest.") }
        manager.loadFromPreferences { error in
            if let error { self.fail(error.localizedDescription) }
            if let config = self.manager.providerConfiguration,
               config.filterDataProviderBundleIdentifier != filterID {
                self.fail("Existing content filter belongs to another application.")
            }
            let config = NEFilterProviderConfiguration()
            config.filterSockets = true
            config.filterPackets = false
            config.filterDataProviderBundleIdentifier = filterID
            self.manager.providerConfiguration = config
            self.manager.localizedDescription = "CA Control Filter Lab"
            self.manager.isEnabled = true
            self.manager.saveToPreferences { error in
                if let error { self.fail(error.localizedDescription) }
                self.manager.loadFromPreferences { error in
                    if let error { self.fail(error.localizedDescription) }
                    guard self.manager.isEnabled,
                          self.manager.providerConfiguration?.filterDataProviderBundleIdentifier == filterID else {
                        self.fail("Could not confirm the saved lab configuration.")
                    }
                    print("Filter enabled in preferences. Verify actual traffic before relying on it.")
                    exit(0)
                }
            }
        }
    }

    private func removePreferences() {
        guard manager.providerConfiguration != nil else { print("No lab filter configuration."); exit(0) }
        manager.removeFromPreferences { error in
            if let error { self.fail(error.localizedDescription) }
            self.manager.loadFromPreferences { error in
                if let error { self.fail(error.localizedDescription) }
                guard self.manager.providerConfiguration == nil else {
                    self.fail("Could not confirm removal of the lab configuration.")
                }
                print("Lab filter configuration removed.")
                exit(0)
            }
        }
    }

    private func fail(_ message: String) -> Never {
        fputs(message + "\n", stderr)
        exit(1)
    }
}

private func main() {
    guard Bundle.main.bundleIdentifier == hostID, CommandLine.arguments.count == 2,
          let action = Action(rawValue: CommandLine.arguments[1]) else {
        fputs("Run the signed lab app with status, enable, or remove.\n", stderr)
        exit(2)
    }
    // The system extension request holds its delegate weakly.
    let controller = Controller(action: action)
    controller.start()
    withExtendedLifetime(controller) { dispatchMain() }
}

main()
