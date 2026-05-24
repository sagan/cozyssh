package config

import (
	"cozyssh/models"
	"os"
	"testing"
)

func TestButtonSorting(t *testing.T) {
	tmp, _ := os.CreateTemp("", "config*.yaml")
	tmp.Close()
	defer os.Remove(tmp.Name())

	cfg := &Config{
		ConfigPath: tmp.Name(),
		Buttons: []*models.ButtonData{
			{Id: "1", Name: "B", Order: 20},
			{Id: "2", Name: "A", Order: 20},
			{Id: "3", Name: "C", Order: 10},
		},
	}

	cfg.SortButtons()

	expectedIDs := []string{"3", "2", "1"}
	for i, b := range cfg.Buttons {
		if b.Id != expectedIDs[i] {
			t.Errorf("Expected button at index %d to be %s, got %s", i, expectedIDs[i], b.Id)
		}
	}
}

func TestMoveButton(t *testing.T) {
	tmp, _ := os.CreateTemp("", "config*.yaml")
	tmp.Close()
	defer os.Remove(tmp.Name())

	cfg := &Config{
		ConfigPath: tmp.Name(),
		Buttons: []*models.ButtonData{
			{Id: "1", Name: "A", Order: 10, Group: "G1"},
			{Id: "2", Name: "B", Order: 20, Group: "G1"},
			{Id: "3", Name: "C", Order: 30, Group: "G1"},
		},
	}

	// Move Right A
	cfg.MoveButton("1", 1)
	if cfg.Buttons[1].Id != "1" {
		t.Errorf("Expected button 1 to move to index 1, got %v", cfg.Buttons)
	}
	if cfg.Buttons[1].Order != 21 {
		t.Errorf("Expected button 1 to have order 21, got %d", cfg.Buttons[1].Order)
	}

	// Move Left A
	cfg.MoveButton("1", -1)
	if cfg.Buttons[0].Id != "1" {
		t.Errorf("Expected button 1 to move back to index 0, got %v", cfg.Buttons)
	}
	if cfg.Buttons[0].Order != 19 {
		t.Errorf("Expected button 1 to have order 19, got %d", cfg.Buttons[0].Order)
	}

	// Test Collision
	cfg.Buttons = []*models.ButtonData{
		{Id: "1", Name: "A", Order: 10, Group: "G1"},
		{Id: "2", Name: "B", Order: 11, Group: "G1"},
		{Id: "3", Name: "C", Order: 12, Group: "G2"},
	}

	// Move Right A -> order 11 -> COLLISION with B
	// Actually, MoveButton logic: newOrder = targetBtn.Order + 1 = 11 + 1 = 12.
	// COLLISION with C (even if different group).
	err := cfg.MoveButton("1", 1)
	if err != nil {
		t.Fatalf("MoveButton failed: %v", err)
	}

	// Should re-sequence: 10, 20, 30
	// New order in slice should be B, A, C?
	// Slice before MoveButton: A, B, C
	// targetIdx is 1 (B)
	// Swap: B, A, C
	// Resequence: B=10, A=20, C=30

	if cfg.Buttons[1].Id != "1" || cfg.Buttons[1].Order != 20 {
		t.Errorf("Expected button 1 to be at index 1 with order 20 after collision, got %+v", cfg.Buttons)
	}

	// Test Legacy Order 0
	cfg.Buttons = []*models.ButtonData{
		{Id: "1", Name: "A", Order: 0, Group: "G1"},
		{Id: "2", Name: "B", Order: 0, Group: "G1"},
		{Id: "3", Name: "C", Order: 0, Group: "G1"},
	}

	// Move Right A
	cfg.MoveButton("1", 1)

	// Should re-sequence to 10, 20, 30 with B, A, C order
	if cfg.Buttons[0].Id != "2" || cfg.Buttons[1].Id != "1" || cfg.Buttons[2].Id != "3" {
		t.Errorf("Expected order B, A, C after moving A right, got %+v", cfg.Buttons)
	}
	if cfg.Buttons[1].Order != 20 {
		t.Errorf("Expected moved button A to have order 20, got %d", cfg.Buttons[1].Order)
	}
}

func TestAddButtonDefaultOrder(t *testing.T) {
	tmp, _ := os.CreateTemp("", "config*.yaml")
	tmp.Close()
	defer os.Remove(tmp.Name())

	cfg := &Config{
		ConfigPath: tmp.Name(),
		Buttons: []*models.ButtonData{
			{Id: "1", Name: "A", Order: 10},
		},
	}

	cfg.AddButton(&models.ButtonData{Id: "2", Name: "B"})
	if cfg.Buttons[1].Order != 20 {
		t.Errorf("Expected new button to have order 20, got %d", cfg.Buttons[1].Order)
	}

	cfg.Buttons = []*models.ButtonData{}
	cfg.AddButton(&models.ButtonData{Id: "3", Name: "C"})
	if cfg.Buttons[0].Order != 10 {
		t.Errorf("Expected first button to have order 10, got %d", cfg.Buttons[0].Order)
	}
}
