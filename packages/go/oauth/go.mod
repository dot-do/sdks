module go.oauth.do

go 1.21

require (
	go.platform.do v0.0.0
	github.com/spf13/cobra v1.8.0
	github.com/zalando/go-keyring v0.2.5
)

require (
	github.com/alessio/shellescape v1.4.1 // indirect
	github.com/danieljoos/wincred v1.2.0 // indirect
	github.com/godbus/dbus/v5 v5.1.0 // indirect
	github.com/inconshreveable/mousetrap v1.1.0 // indirect
	github.com/spf13/pflag v1.0.5 // indirect
	golang.org/x/sys v0.8.0 // indirect
)

replace go.platform.do => ../dotdo

replace go.rpc.do => ../rpc

replace go.capnweb.do => ../capnweb
