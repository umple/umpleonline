package model

// A saved model's id and Umple text, returned together when a handler needs both.

// Model represents a saved Umple model on disk.
type Model struct {
	ID   string `json:"id"`
	Code string `json:"code"`
}
