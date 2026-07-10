package models

import (
	"encoding/json"
)

var (
	WsMsgStateConnecting, _ = json.Marshal(&WsTerminalMessage{
		Type:  WsTerminalMessageTypeState,
		State: "connecting",
	})
	WsMsgStateDisconnected, _ = json.Marshal(&WsTerminalMessage{
		Type:  WsTerminalMessageTypeState,
		State: "disconnected",
	})
	WsMsgStateExited, _ = json.Marshal(&WsTerminalMessage{
		Type:  WsTerminalMessageTypeState,
		State: "exited",
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
		Type: WsTerminalMessageTypeTabState,
	})
	WsMsgTabStatePinned, _ = json.Marshal(&WsTerminalMessage{
		Type:     WsTerminalMessageTypeTabState,
		IsPinned: true,
	})
	WsMsgTabStateLocked, _ = json.Marshal(&WsTerminalMessage{
		Type:     WsTerminalMessageTypeTabState,
		IsPinned: true,
		IsLocked: true,
	})
	WsMsgTabStateHidden, _ = json.Marshal(&WsTerminalMessage{
		Type:     WsTerminalMessageTypeTabState,
		IsPinned: true,
		IsLocked: true,
		IsHidden: true,
	})
)

func GetWsTabStateMsg(isPinned bool, isLocked bool, isHidden bool) []byte {
	if isHidden {
		return WsMsgTabStateHidden
	}
	if isLocked {
		return WsMsgTabStateLocked
	}
	if isPinned {
		return WsMsgTabStatePinned
	}
	return WsMsgTabStateNormal
}
