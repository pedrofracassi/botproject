# botproject

This is my attempt at writing a Discord bot from the ground up, so I can have more control over how it behaves and caches data, probably by using Redis (existent libraries don't allow this out-of-the-box, and getting one of them to work with async caching would be way too time consuming).

## Roadmap

### Gateway Connection

- [x] Get the endpoint from the API
- [x] Connect to the gateway
- [x] Send heartbeats every X milliseconds
- [ ] Check for ACKs between heartbeats and terminate the connection if need be
- [ ] Resume connections if needed
- [ ] Send heartbeats when the gateway requests them
- [x] Identify
- [ ] Listen for Dispatch events