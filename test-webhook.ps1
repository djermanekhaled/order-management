# Smoke test for WooCommerce delivery via api/handler. Edit BaseUrl and ChannelId, then run:
#   .\test-webhook.ps1
param(
    [string] $BaseUrl = "https://YOUR_VERCEL_DOMAIN",
    [string] $ChannelId = "YOUR_SALES_CHANNEL_UUID"
)

Invoke-RestMethod -Uri "$BaseUrl/api/handler?action=woo-webhook&channel_id=$ChannelId" -Method Post -ContentType "application/json; charset=utf-8" -Body '{"id":1001,"status":"pending","total":"1500.00","billing":{"first_name":"Test","last_name":"User","phone":"0555123456","address_1":"1 Rue Test","state":"Alger"},"line_items":[{"name":"Produit test","quantity":2}]}'
