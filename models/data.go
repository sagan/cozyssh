package models

import (
	"encoding/json"
)

var (
	WsMsgStateConnecting, _ = json.Marshal(&WsTerminalMessage{
		Type:  WsTerminalMessageTypeState,
		State: "connecting to ssh server",
	})
	WsMsgStateDisconnected, _ = json.Marshal(&WsTerminalMessage{
		Type:  WsTerminalMessageTypeState,
		State: "disconnected to ssh server",
	})
	WsMsgStateDisconnectedFatal, _ = json.Marshal(&WsTerminalMessage{
		Type:  WsTerminalMessageTypeState,
		State: "disconnected (fatal)",
	})
	WsMsgStateConnected, _ = json.Marshal(&WsTerminalMessage{
		Type:  WsTerminalMessageTypeState,
		State: "connected",
	})
	WsMsgStateStolen, _ = json.Marshal(&WsTerminalMessage{
		Type:  WsTerminalMessageTypeState,
		State: "stolen",
	})
	WsMsgHistoryStart, _ = json.Marshal(&WsTerminalMessage{
		Type: WsTerminalMessageTypeHistoryStart,
	})
	WsMsgTabStateNormal, _ = json.Marshal(&WsTerminalMessage{
		Type:     WsTerminalMessageTypeTabState,
		IsPinned: false,
		IsLocked: false,
	})
	WsMsgTabStatePinned, _ = json.Marshal(&WsTerminalMessage{
		Type:     WsTerminalMessageTypeTabState,
		IsPinned: true,
		IsLocked: false,
	})
	WsMsgTabStateLocked, _ = json.Marshal(&WsTerminalMessage{
		Type:     WsTerminalMessageTypeTabState,
		IsPinned: true,
		IsLocked: true,
	})
)

func GetWsTabStateMsg(isPinned bool, isLocked bool) []byte {
	if isLocked {
		return WsMsgTabStateLocked
	}
	if isPinned {
		return WsMsgTabStatePinned
	}
	return WsMsgTabStateNormal
}
