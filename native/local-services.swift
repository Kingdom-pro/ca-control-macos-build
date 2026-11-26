import Foundation
import Security
import SystemConfiguration

let service = "com.cacontrol.macos.proxy"
let item: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service,
    kSecAttrAccount as String: "current-profile"
]

func readProfile() -> Int32 {
    var query = item
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var value: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &value)
    if status == errSecItemNotFound {
        print("null")
        return 0
    }
    guard status == errSecSuccess, let data = value as? Data else { return 1 }
    FileHandle.standardOutput.write(data)
    return 0
}

func saveProfile() -> Int32 {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard !data.isEmpty, data.count <= 8192,
        (try? JSONSerialization.jsonObject(with: data)) is [String: Any] else { return 1 }
    let attributes = [kSecValueData as String: data]
    var status = SecItemUpdate(item as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
        var record = item
        record[kSecValueData as String] = data
        status = SecItemAdd(record as CFDictionary, nil)
    }
    return status == errSecSuccess ? 0 : 1
}

func uplink() -> String {
    guard let store = SCDynamicStoreCreate(nil, service as CFString, nil, nil) else { return "unknown" }
    for family in ["IPv4", "IPv6"] {
        let key = "State:/Network/Global/\(family)"
        guard let state = SCDynamicStoreCopyValue(store, key as CFString) as? [String: Any],
            let primary = state["PrimaryInterface"] as? String else { continue }
        let interfaces = SCNetworkInterfaceCopyAll() as? [SCNetworkInterface] ?? []
        guard let interface = interfaces.first(where: { (SCNetworkInterfaceGetBSDName($0) as String?) == primary }),
            let kind = SCNetworkInterfaceGetInterfaceType(interface) as String? else { return "unknown" }
        if kind == (kSCNetworkInterfaceTypeIEEE80211 as String) { return "wifi" }
        if kind == (kSCNetworkInterfaceTypeEthernet as String) { return "ethernet" }
        return "other"
    }
    return "unknown"
}

switch CommandLine.arguments.dropFirst().first ?? "" {
case "read": exit(readProfile())
case "save": exit(saveProfile())
case "uplink": print(uplink())
default: exit(2)
}
