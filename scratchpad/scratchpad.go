package scratchpad

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"cozyssh/auth"
)

type ScratchpadPage struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Content     string `json:"content"`
	Locked      bool   `json:"locked,omitempty"`
	LastUpdated int64  `json:"lastUpdated"`
}

type ScratchpadData struct {
	Pages []ScratchpadPage `json:"pages"`
}

type MsgType struct {
	Type string `json:"type"`
}

type SyncMsg struct {
	Type string         `json:"type"`
	Data ScratchpadData `json:"data"`
}

type DeleteMsg struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

var (
	globalData ScratchpadData
	dataMu     sync.RWMutex
	conns      = make(map[*websocket.Conn]bool)
	connsMu    sync.Mutex
	configDir  string
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// Init loads the scratchpad data from the config directory
func Init(cDir string) {
	configDir = cDir
	globalData = ScratchpadData{
		Pages: []ScratchpadPage{},
	}

	path := filepath.Join(configDir, "scratchpad.json")
	data, err := os.ReadFile(path)
	if err == nil {
		var d ScratchpadData
		if err := json.Unmarshal(data, &d); err == nil {
			if len(d.Pages) > 0 {
				globalData = d
			}
		}
	}
	if len(globalData.Pages) == 0 {
		globalData.Pages = []ScratchpadPage{{
			ID:          fmt.Sprintf("%x", time.Now().UnixNano()),
			Title:       "Default",
			Content:     "",
			LastUpdated: time.Now().UnixMilli(),
		}}
		save()
	}
}

func save() {
	if configDir == "" {
		return
	}
	path := filepath.Join(configDir, "scratchpad.json")
	data, err := json.Marshal(globalData)
	if err != nil {
		log.Println("scratchpad save error:", err)
		return
	}
	os.WriteFile(path, data, 0600)
}

func broadcast(msg []byte, exclude *websocket.Conn) {
	connsMu.Lock()
	defer connsMu.Unlock()
	for c := range conns {
		if c != exclude {
			c.WriteMessage(websocket.TextMessage, msg)
		}
	}
}

// HandleWS handles the WebSocket connection for Scratchpad
func HandleWS(w http.ResponseWriter, r *http.Request) {
	if !auth.WSAuth(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	header := make(http.Header)
	if protocols := r.Header.Get("Sec-WebSocket-Protocol"); protocols != "" {
		parts := strings.Split(protocols, ",")
		for _, p := range parts {
			p = strings.TrimSpace(p)
			if strings.HasPrefix(p, "cozy.") {
				header.Set("Sec-WebSocket-Protocol", p)
				break
			}
		}
	}

	conn, err := upgrader.Upgrade(w, r, header)
	if err != nil {
		log.Println("scratchpad ws upgrade error:", err)
		return
	}
	defer conn.Close()

	connsMu.Lock()
	conns[conn] = true
	connsMu.Unlock()

	defer func() {
		connsMu.Lock()
		delete(conns, conn)
		connsMu.Unlock()
	}()

	for {
		mt, msg, err := conn.ReadMessage()
		if err != nil || mt != websocket.TextMessage {
			break
		}

		var base MsgType
		if err := json.Unmarshal(msg, &base); err != nil {
			continue
		}

		if base.Type == "hello" {
			// Client announces itself. Send our current state unconditionally to align them.
			dataMu.RLock()
			syncBytes, _ := json.Marshal(SyncMsg{Type: "sync", Data: globalData})
			dataMu.RUnlock()
			conn.WriteMessage(websocket.TextMessage, syncBytes)

		} else if base.Type == "sync" {
			var sm SyncMsg
			if err := json.Unmarshal(msg, &sm); err == nil {
				dataMu.Lock()
				
				changed := false
				var updatedPages []ScratchpadPage

				for _, cp := range sm.Data.Pages {
					found := false
					for i := range globalData.Pages {
						if globalData.Pages[i].ID == cp.ID {
							found = true
							if cp.LastUpdated > globalData.Pages[i].LastUpdated {
								globalData.Pages[i] = cp
								updatedPages = append(updatedPages, cp)
								changed = true
							}
							break
						}
					}
					if !found {
						globalData.Pages = append(globalData.Pages, cp)
						updatedPages = append(updatedPages, cp)
						changed = true
					}
				}

				// Special case: if client sends ALL pages (likely a deletion or full sync)
				// we need to check for deletions. 
				// However, our current partial sync only sends DIRTY pages.
				// Deletions are triggered by sending the full set.
				if len(sm.Data.Pages) > 1 && len(sm.Data.Pages) < len(globalData.Pages) {
					// This logic is tricky if we don't know if it's a full sync.
					// For now, assume if the client sends a list and it's missing something 
					// that the client previously knew about, it's a deletion.
					// BUT we don't know what the client knew.
					// Let's decide: If Data carries multiple pages, we might treat it as 
					// the authoritative full list if it has a special flag.
					// For now, we only handle UPDATES/ADDS as partial.
				}

				if changed {
					save()
					// Broadcast updated pages to ALL clients (including sender) 
					// so they know the sync is complete and can update UI.
					syncBytes, _ := json.Marshal(SyncMsg{Type: "sync", Data: ScratchpadData{Pages: updatedPages}})
					broadcast(syncBytes, nil)
				} else {
					// Even if nothing changed, acknowledge the sync so the client stops "syncing" state
					syncBytes, _ := json.Marshal(SyncMsg{Type: "sync", Data: ScratchpadData{Pages: []ScratchpadPage{}}})
					conn.WriteMessage(websocket.TextMessage, syncBytes)
				}
				dataMu.Unlock()
			}
		} else if base.Type == "delete" {
			var dm DeleteMsg
			if err := json.Unmarshal(msg, &dm); err == nil {
				dataMu.Lock()
				found := false
				for i := range globalData.Pages {
					if globalData.Pages[i].ID == dm.ID {
						// Remove page
						globalData.Pages = append(globalData.Pages[:i], globalData.Pages[i+1:]...)
						found = true
						break
					}
				}
				if found {
					save()
					// Broadcast the deletion to everyone
					broadcast(msg, nil)
				} else {
					// Acknowledge anyway
					ack, _ := json.Marshal(DeleteMsg{Type: "delete", ID: dm.ID})
					conn.WriteMessage(websocket.TextMessage, ack)
				}
				dataMu.Unlock()
			}
		}
	}
}

// Reload re-reads the scratchpad.json file from disk and broadcasts a force_sync msg
func Reload() {
	if configDir == "" {
		return
	}
	path := filepath.Join(configDir, "scratchpad.json")
	data, err := os.ReadFile(path)
	if err == nil {
		var d ScratchpadData
		if err := json.Unmarshal(data, &d); err == nil {
			if len(d.Pages) > 0 {
				dataMu.Lock()
				globalData = d
				syncBytes, _ := json.Marshal(SyncMsg{Type: "force_sync", Data: globalData})
				dataMu.Unlock()
				broadcast(syncBytes, nil)
			}
		}
	}
}
