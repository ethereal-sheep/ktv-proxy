# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
People at a home or party KTV session, using their own phones as a remote for the KTV box in the room. They search for songs, queue them, and watch what is playing. Often one-handed, in dim light, in a social setting.

## Product Purpose
A React front end for the Jetty KTV box's servlets, served from a small Node proxy on the same origin. It replaces the box's built-in UI so guests can find and queue songs quickly. Success: a guest finds a song and queues it in seconds without help.

## Positioning
Quality-of-life features the box's own UI lacks: infinite scrolling, unified song filters, favourites (with categories), history, and a current-playing-song view. Self-hosted on the LAN (Docker or Proxmox LXC).

## Operating Context
Runs on the home network. The user enters the box's IP, or uses "Search my network" (a /24 scan for port 8084). The proxy `/api/*` is unauthenticated and LAN-only. Favourites, history and categories are stored locally in `ktv.db`. API docs are at `/api/docs`.

## Capabilities and Constraints
- Song and singer search, filters, queue management (add, play next, remove), player buttons such as skip.
- Favourites with user categories, history, current song and queue.
- UI language is English. Song and singer content is Chinese, with pinyin search.
- Only the proxy talks to the box. The browser never calls it directly.

## Evidence on Hand
No testimonials, usage data or brand assets exist. Don't fabricate any.

## Product Principles
- Speed to queue beats feature depth: the core path is search, then add.
- Built for a phone in a dark room, held in one hand.
- Chinese content must render and sort correctly.
- Stay a thin remote over the box: no accounts, no cloud.

## Accessibility & Inclusion
No product-specific requirement established. Standard accessibility applies.
