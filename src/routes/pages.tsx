import { Hono } from 'hono'
import { html } from 'hono/html'

type Bindings = { DB: D1Database }
export const pageRoutes = new Hono<{ Bindings: Bindings }>()

pageRoutes.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>ZoomClone - Video Conferencing</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css"/>
  <link rel="stylesheet" href="/static/style.css"/>
</head>
<body class="bg-gray-950 text-white min-h-screen">
  <div id="app">
    <!-- Login/Register or Dashboard based on auth -->
  </div>
  <script src="/static/app.js"></script>
</body>
</html>`)
})

pageRoutes.get('/room/:code', (c) => {
  const code = c.req.param('code')
  return c.html(`<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Meeting Room - ZoomClone</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css"/>
  <link rel="stylesheet" href="/static/style.css"/>
</head>
<body class="bg-gray-950 text-white min-h-screen overflow-hidden">
  <div id="meeting-app" data-code="${code}"></div>
  <script>window.MEETING_CODE = "${code}";</script>
  <script src="/static/room.js"></script>
</body>
</html>`)
})
