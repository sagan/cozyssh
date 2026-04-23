package scratchpad

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
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

	conn, err := upgrader.Upgrade(w, r, nil)
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
				
				// Build a map of global pages
				globalMap := make(map[string]*ScratchpadPage)
				for i := range globalData.Pages {
					globalMap[globalData.Pages[i].ID] = &globalData.Pages[i]
				}

				changed := false
				var newGlobalPages []ScratchpadPage

				// For pages from client
				clientMap := make(map[string]*ScratchpadPage)
				for i := range sm.Data.Pages {
					cp := sm.Data.Pages[i]
					clientMap[cp.ID] = &cp
					
					gp, exists := globalMap[cp.ID]
					if !exists || cp.LastUpdated > gp.LastUpdated {
						// Client has a new or updated page
						newGlobalPages = append(newGlobalPages, cp)
						changed = true
					} else {
						// Keep global page
						newGlobalPages = append(newGlobalPages, *gp)
						if cp.LastUpdated < gp.LastUpdated {
							changed = true // Need to push this back to client
						}
					}
				}

				// Check for deletions: if a global page is missing from client, and its LastUpdated
				// hasn't changed since the client last synced. 
				// Actually, if client deleted it, we accept the deletion if client claims authority.
				// For simple conflict resolution: If client omits a page, we assume client deleted it.
				// However, if the server updated it more recently than what the client knew, we should keep it.
				// But we don't know what the client knew. So deletions from client win.
				if len(globalData.Pages) != len(newGlobalPages) {
					changed = true
				}

				globalData.Pages = newGlobalPages
				save()

				if changed {
					syncBytes, _ := json.Marshal(SyncMsg{Type: "sync", Data: globalData})
					broadcast(syncBytes, conn)
					// Also send back to sender if they are missing newer data
					// But for simplicity, we can just echo the current state to the sender
					// to ensure they are fully aligned with the merged state.
					conn.WriteMessage(websocket.TextMessage, syncBytes)
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
