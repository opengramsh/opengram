import Carbon
import Combine
import SwiftUI

// MARK: - Shortcut Configuration

struct GlobalShortcutConfig: Codable, Equatable {
    var keyCode: UInt16
    var modifierFlags: UInt
    var isEnabled: Bool

    static let `default` = GlobalShortcutConfig(
        keyCode: UInt16(kVK_ANSI_O),
        modifierFlags: NSEvent.ModifierFlags([.command, .shift]).rawValue,
        isEnabled: true
    )

    var carbonModifiers: UInt32 {
        var mods: UInt32 = 0
        let flags = NSEvent.ModifierFlags(rawValue: modifierFlags)
        if flags.contains(.command) { mods |= UInt32(cmdKey) }
        if flags.contains(.shift) { mods |= UInt32(shiftKey) }
        if flags.contains(.option) { mods |= UInt32(optionKey) }
        if flags.contains(.control) { mods |= UInt32(controlKey) }
        return mods
    }

    var displayString: String {
        var parts: [String] = []
        let flags = NSEvent.ModifierFlags(rawValue: modifierFlags)
        if flags.contains(.control) { parts.append("⌃") }
        if flags.contains(.option) { parts.append("⌥") }
        if flags.contains(.shift) { parts.append("⇧") }
        if flags.contains(.command) { parts.append("⌘") }
        parts.append(Self.keyName(for: keyCode))
        return parts.joined(separator: " ")
    }

    static func keyName(for keyCode: UInt16) -> String {
        switch Int(keyCode) {
        case kVK_ANSI_A: return "A"
        case kVK_ANSI_B: return "B"
        case kVK_ANSI_C: return "C"
        case kVK_ANSI_D: return "D"
        case kVK_ANSI_E: return "E"
        case kVK_ANSI_F: return "F"
        case kVK_ANSI_G: return "G"
        case kVK_ANSI_H: return "H"
        case kVK_ANSI_I: return "I"
        case kVK_ANSI_J: return "J"
        case kVK_ANSI_K: return "K"
        case kVK_ANSI_L: return "L"
        case kVK_ANSI_M: return "M"
        case kVK_ANSI_N: return "N"
        case kVK_ANSI_O: return "O"
        case kVK_ANSI_P: return "P"
        case kVK_ANSI_Q: return "Q"
        case kVK_ANSI_R: return "R"
        case kVK_ANSI_S: return "S"
        case kVK_ANSI_T: return "T"
        case kVK_ANSI_U: return "U"
        case kVK_ANSI_V: return "V"
        case kVK_ANSI_W: return "W"
        case kVK_ANSI_X: return "X"
        case kVK_ANSI_Y: return "Y"
        case kVK_ANSI_Z: return "Z"
        case kVK_ANSI_0: return "0"
        case kVK_ANSI_1: return "1"
        case kVK_ANSI_2: return "2"
        case kVK_ANSI_3: return "3"
        case kVK_ANSI_4: return "4"
        case kVK_ANSI_5: return "5"
        case kVK_ANSI_6: return "6"
        case kVK_ANSI_7: return "7"
        case kVK_ANSI_8: return "8"
        case kVK_ANSI_9: return "9"
        case kVK_Space: return "Space"
        case kVK_Return: return "↩"
        case kVK_Tab: return "⇥"
        case kVK_Escape: return "⎋"
        case kVK_F1: return "F1"
        case kVK_F2: return "F2"
        case kVK_F3: return "F3"
        case kVK_F4: return "F4"
        case kVK_F5: return "F5"
        case kVK_F6: return "F6"
        case kVK_F7: return "F7"
        case kVK_F8: return "F8"
        case kVK_F9: return "F9"
        case kVK_F10: return "F10"
        case kVK_F11: return "F11"
        case kVK_F12: return "F12"
        case kVK_ANSI_Minus: return "-"
        case kVK_ANSI_Equal: return "="
        case kVK_ANSI_LeftBracket: return "["
        case kVK_ANSI_RightBracket: return "]"
        case kVK_ANSI_Backslash: return "\\"
        case kVK_ANSI_Semicolon: return ";"
        case kVK_ANSI_Quote: return "'"
        case kVK_ANSI_Comma: return ","
        case kVK_ANSI_Period: return "."
        case kVK_ANSI_Slash: return "/"
        case kVK_ANSI_Grave: return "`"
        default: return "Key\(keyCode)"
        }
    }
}

// MARK: - Global Shortcut Service

/// Weak reference to the shared service instance so the Carbon C callback can reach it.
private weak var _sharedService: GlobalShortcutService?

@MainActor
class GlobalShortcutService: ObservableObject {
    @Published var config: GlobalShortcutConfig

    private var hotKeyRef: EventHotKeyRef?
    private var eventHandlerRef: EventHandlerRef?

    var onToggle: (() -> Void)?

    init() {
        if let data = UserDefaults.standard.data(forKey: "globalShortcut"),
           let decoded = try? JSONDecoder().decode(GlobalShortcutConfig.self, from: data)
        {
            self.config = decoded
        } else {
            self.config = .default
        }
        _sharedService = self
        if config.isEnabled {
            register()
        }
    }

    deinit {
        if let ref = hotKeyRef {
            UnregisterEventHotKey(ref)
        }
        if let ref = eventHandlerRef {
            RemoveEventHandler(ref)
        }
        if _sharedService === self { _sharedService = nil }
    }

    // MARK: - Registration

    func register() {
        unregister()
        guard config.isEnabled else { return }

        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )

        let installStatus = InstallEventHandler(
            GetApplicationEventTarget(),
            { _, _, _ -> OSStatus in
                DispatchQueue.main.async {
                    _sharedService?.onToggle?()
                }
                return noErr
            },
            1,
            &eventType,
            nil,
            &eventHandlerRef
        )
        guard installStatus == noErr else { return }

        var hotKeyID = EventHotKeyID(
            signature: OSType(0x4F47_5254),  // "OGRT"
            id: 1
        )

        RegisterEventHotKey(
            UInt32(config.keyCode),
            config.carbonModifiers,
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &hotKeyRef
        )
    }

    func unregister() {
        if let ref = hotKeyRef {
            UnregisterEventHotKey(ref)
            hotKeyRef = nil
        }
        if let ref = eventHandlerRef {
            RemoveEventHandler(ref)
            eventHandlerRef = nil
        }
    }

    // MARK: - Update

    func updateShortcut(keyCode: UInt16, modifiers: NSEvent.ModifierFlags) {
        config = GlobalShortcutConfig(
            keyCode: keyCode,
            modifierFlags: modifiers.rawValue,
            isEnabled: config.isEnabled
        )
        save()
        register()
    }

    func setEnabled(_ enabled: Bool) {
        config.isEnabled = enabled
        save()
        if enabled {
            register()
        } else {
            unregister()
        }
    }

    private func save() {
        if let data = try? JSONEncoder().encode(config) {
            UserDefaults.standard.set(data, forKey: "globalShortcut")
        }
    }
}

// MARK: - Shortcut Recorder View

struct ShortcutRecorderView: View {
    @ObservedObject var service: GlobalShortcutService
    @State private var isRecording = false
    @State private var monitor: Any?

    var body: some View {
        HStack(spacing: 8) {
            Text(isRecording ? "Press shortcut…" : service.config.displayString)
                .font(.system(.body, design: .rounded).weight(.medium))
                .frame(minWidth: 100)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(isRecording ? Color.accentColor.opacity(0.15) : Color.secondary.opacity(0.1))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .strokeBorder(isRecording ? Color.accentColor : Color.clear, lineWidth: 1.5)
                )

            Button(isRecording ? "Cancel" : "Record") {
                if isRecording {
                    stopRecording()
                } else {
                    startRecording()
                }
            }

            if !isRecording {
                Button("Clear") {
                    service.setEnabled(false)
                }
                .foregroundStyle(.secondary)
                .disabled(!service.config.isEnabled)
            }
        }
    }

    private func startRecording() {
        isRecording = true
        service.unregister()

        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            let mods = event.modifierFlags.intersection(.deviceIndependentFlagsMask)

            // Escape cancels recording
            if event.keyCode == UInt16(kVK_Escape) {
                stopRecording()
                return nil
            }

            // Require at least one modifier key (not just a bare letter)
            if mods.contains(.command) || mods.contains(.control) || mods.contains(.option) {
                service.updateShortcut(keyCode: event.keyCode, modifiers: mods)
                service.setEnabled(true)
                stopRecording()
                return nil
            }

            return event
        }
    }

    private func stopRecording() {
        isRecording = false
        if let monitor = monitor {
            NSEvent.removeMonitor(monitor)
            self.monitor = nil
        }
        if service.config.isEnabled {
            service.register()
        }
    }
}
