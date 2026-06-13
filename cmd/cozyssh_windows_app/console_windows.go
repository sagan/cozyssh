package main

import (
	"os"
	"syscall"
	"unsafe"
)

var (
	modkernel32       = syscall.NewLazyDLL("kernel32.dll")
	procAttachConsole = modkernel32.NewProc("AttachConsole")
	procCreateFileW   = modkernel32.NewProc("CreateFileW")

	moduser32      = syscall.NewLazyDLL("user32.dll")
	procKeybdEvent = moduser32.NewProc("keybd_event")
)

const (
	VK_RETURN       = 0x0D
	KEYEVENTF_KEYUP = 0x0002

	// Windows file access constants
	GENERIC_READ          = 0x80000000
	GENERIC_WRITE         = 0x40000000
	FILE_SHARE_READ       = 0x00000001
	FILE_SHARE_WRITE      = 0x00000002
	OPEN_EXISTING         = 3
	FILE_ATTRIBUTE_NORMAL = 0x80
)

func attachToParentConsole() bool {
	const ATTACH_PARENT_PROCESS = ^uint32(0)

	// 1. Attach to the parent shell terminal
	r1, _, _ := procAttachConsole.Call(uintptr(ATTACH_PARENT_PROCESS))
	if r1 == 0 {
		return false
	}

	// 2. Fix Standard Output and Standard Error
	hout, err1 := syscall.GetStdHandle(syscall.STD_OUTPUT_HANDLE)
	herr, err2 := syscall.GetStdHandle(syscall.STD_ERROR_HANDLE)
	if err1 == nil && err2 == nil {
		os.Stdout = os.NewFile(uintptr(hout), "/dev/stdout")
		os.Stderr = os.NewFile(uintptr(herr), "/dev/stderr")
	}

	// 3. FIX: Open "CONIN$" with explicit system sharing permissions
	coninPtr, _ := syscall.UTF16PtrFromString("CONIN$")
	hIn, _, _ := procCreateFileW.Call(
		uintptr(unsafe.Pointer(coninPtr)),
		GENERIC_READ|GENERIC_WRITE,
		FILE_SHARE_READ|FILE_SHARE_WRITE, // Crucial for Go's internal buffer poolers
		0,
		OPEN_EXISTING,
		FILE_ATTRIBUTE_NORMAL,
		0,
	)

	if syscall.Handle(hIn) != syscall.InvalidHandle {
		os.Stdin = os.NewFile(hIn, "/dev/stdin")
	}

	return true
}

func releaseConsoleCleanly() {
	procKeybdEvent.Call(uintptr(VK_RETURN), 0, 0, 0)
	procKeybdEvent.Call(uintptr(VK_RETURN), 0, uintptr(KEYEVENTF_KEYUP), 0)
}
