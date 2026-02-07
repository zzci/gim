/_ Matrix Specifification s _/

## server

```
/.well-known/matrix/client
/.well-known/matrix/server
/_matrix/client/versions
/_matrix/client/v3/capabilities
```

## account
```
/_matrix/client/v3/login
/_matrix/client/v3/logout
/_matrix/client/v3/account/whoami

/_matrix/client/v3/profile/:uid
/_matrix/client/v3/profile/:uid/avatar_url
/_matrix/client/v3/profile/:uid/displayname
/_matrix/client/v3/profile/:uid/account_data/:type

/_matrix/client/v3/user/:uid/rooms/:roomid/account_data:type
/_matrix/client/v3/user/:uid/rooms/:roomid/tags

/_matrix/client/v3/user_directory/search
```

## device
```
/_matrix/client/v3/devices
/_matrix/client/v3/devices/:id
/_matrix/client/v3/delete_devices

/_matrix/client/v3/sendToDevice/{eventType}/{txnId}
```

## room

```
/_matrix/client/v3/createRoom
/_matrix/client/v3/join/:id
/_matrix/client/v3/rooms/{roomId}/invite
/_matrix/client/v3/joined_rooms

/_matrix/client/v3/sync
```
