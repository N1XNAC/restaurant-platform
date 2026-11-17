# Smart Restaurant — Customer & Management System API Contract

This document defines the REST integration contract between the **Customer-Side Web Application** and the separate **Restaurant-Side Management Dashboard / KDS**.

## Base URL & Authentication
- Customer API prefix: `/api`
- Every table session is bound on the server via HMAC signature (`sessionSignature`) generated exclusively after `POST /api/session/validate` verifies an opaque QR/NFC token (`?token=...`).
- Browser-supplied `restaurantId`, `tableId`, or `unitPrice` values are **never trusted**; orders are rejected (`403 TABLE_MISMATCH`) if identifiers differ from the bound session, and all line-item prices, taxes, and service charges are recomputed strictly on the server.

## Customer-Facing Endpoints

### 1. Validate QR / NFC Table Token
`POST /api/session/validate`
```json
{
  "token": "QR_MV_T08_VALID",
  "gps": { "lat": 37.7749, "lng": -122.4194, "accuracy": 20 }
}
```
Response (`200 OK`): Returns `session` containing `sessionId`, `sessionSignature`, `restaurantId`, `tableId`, `tableLabel`, `entryMethod` (`QR` | `NFC`), `locationStatus`, `requiresAdditionalVerification`, `expiresAt`, and `restaurant` details.

### 2. Secondary Location & Table Placard Verification
- `POST /api/session/verify-location` (`{ sessionId, sessionSignature, gps }`)
- `POST /api/session/verify-challenge` (`{ sessionId, sessionSignature, pin }`) — verifies the 4-digit placard PIN printed under the table QR when GPS falls outside the geofence radius.

### 3. Fetch Menu & Dish Details
- `GET /api/restaurant/:restaurantId/menu?search=&category=&dietary=`
- `GET /api/menu/items/:itemId`

### 4. Submit Customer Order
`POST /api/orders`
```json
{
  "restaurantId": "REST_001",
  "tableId": "TABLE_08",
  "sessionId": "SESSION_A1B2C3",
  "sessionSignature": "<hmac>",
  "idempotencyKey": "uuid-v4",
  "orderMode": "table_cart",
  "items": [
    {
      "itemId": "ITEM_001",
      "name": "Classic Brioche Burger",
      "quantity": 2,
      "selectedOptions": []
    }
  ]
}
```
Response (`201 Created`): Returns authoritative `order` with `orderId` (`ORDER_...`), server-computed `subtotal`, `taxAmount`, `serviceCharge`, `grandTotal`, `status: "RECEIVED"`, `createdAt`, and `cancellableUntil`.

### 5. Track & Cancel Order
- `GET /api/orders/:orderId` — returns live status (`RECEIVED` | `PREPARING` | `READY` | `SERVED` | `CANCELLED`).
- `POST /api/orders/:orderId/cancel` — cancels order within the restaurant's kitchen fire grace window.

## Restaurant Management Integration Endpoints
- `GET /api/integration/orders?restaurantId=REST_001` — feed of placed customer orders with `tableId`, `tableNumber`, `items`, `customizations`, `grandTotal`, and timestamps.
- `PATCH /api/integration/orders/:orderId/status` (`{ "status": "PREPARING" | "READY" | "SERVED" | "CANCELLED" }`) — allows KDS/POS dashboard to advance order status.
- Optional Webhook Push: configure `RESTAURANT_MGMT_WEBHOOK_URL` and `RESTAURANT_MGMT_API_KEY` in environment variables to receive `ORDER_CREATED` and `ORDER_CANCELLED` POST events immediately upon order placement.
