package main

import (
	"os"
	"path/filepath"
)

// constant defination file

func init() {
	filePath, _ := filepath.Abs(os.Args[0])
	rootDir = filepath.Dir(filePath)
}

// root path
var rootDir string

// database file
const dbFile string = "msc_lite_storage.db"

// audio folder
const audioFolder string = ""
