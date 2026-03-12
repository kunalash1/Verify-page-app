import { useRef, useState } from "react"
import QRCode from "qrcode"

const BASE_URL = "/verify"

const VERIFY_BASE_URL =
  import.meta.env.VITE_VERIFY_BASE_URL || ""

const CLIENT_ID =
  import.meta.env.VITE_CLIENT_ID || ""


function generateUUID() {
  if (window.crypto && crypto.randomUUID) {
    return crypto.randomUUID()
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function VerifyQR() {

  const canvasRef = useRef(null)

  const [message, setMessage] = useState("")
  const [messageColor, setMessageColor] = useState("red")
  const [showQR, setShowQR] = useState(false)


  async function createVPRequest() {

    const body = {
      clientId: CLIENT_ID,
      nonce: Date.now().toString(),
      acceptVPWithoutHolderProof: true,
      presentationDefinition: {
        id: generateUUID(),
        purpose: "Self authentication",
        input_descriptors: [
          {
            id: "id card credential",
            format: {
              ldp_vc: {
                proof_type: ["Ed25519Signature2020"]
              }
            },
            constraints: {
              fields: [
                {
                  path: ["$.type"],
                  filter: {
                    type: "string",
                    pattern: "ECACredential"
                  }
                }
              ]
            }
          }
        ]
      }
    }

    const res = await fetch(`${BASE_URL}/v1/verify/vp-request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    })

    if (!res.ok) {
      throw new Error("Failed to create VP request")
    }

    return res.json()
  }


  async function pollStatus(requestId, txnId) {

    while (true) {

      const statusRes = await fetch(
        `${BASE_URL}/v1/verify/vp-request/${requestId}/status`
      )

      const status = await statusRes.json()

      if (status.status === "EXPIRED") {
        setShowQR(false)
        setMessageColor("red")
        setMessage("QR expired")
        return
      }

      if (status.status === "VP_SUBMITTED") {

        const resultRes = await fetch(
          `${BASE_URL}/v1/verify/vp-result-verify-age/${txnId}`
        )

        const result = await resultRes.json()

        setShowQR(false)

        if (result.verificationStatus !== "SUCCESS") {
          setMessageColor("red")
          setMessage("VC is not valid")
          return
        }

        if (result.vpVerificationStatus !== "SUCCESS") {
          setMessageColor("red")
          setMessage("VC is not valid")
          return
        }

        if (result.isAdult === false) {
          setMessageColor("red")
          setMessage("Access denied.")
          return
        }

        if (result.verificationStatus === "SUCCESS" && result.isAdult === true) {
          setMessageColor("green")
          setMessage("18+ Verified")
          return
        }
      }

      await new Promise((r) => setTimeout(r, 1000))
    }
  }


  const startQRVerification = async () => {

    try {

      setMessage("")
      setShowQR(true)

      const data = await createVPRequest()

      const requestId = data.requestId
      const txnId = data.transactionId

      const requestUri =
        `${VERIFY_BASE_URL}/v1/verify/vp-request/${requestId}`

      const deepLink =
        `openid4vp://authorize?client_id=${encodeURIComponent(CLIENT_ID)}` +
        `&request_uri=${encodeURIComponent(requestUri)}`

      if (canvasRef.current) {
        await QRCode.toCanvas(canvasRef.current, deepLink, { width: 260 })
      }

      pollStatus(requestId, txnId)

    } catch (err) {

      console.error(err)
      setShowQR(false)
      setMessageColor("red")
      setMessage("Verification failed")

    }
  }


  const openWalletVerification = async () => {

    try {

      setMessage("")
      setShowQR(false)

      const data = await createVPRequest()

      const requestId = data.requestId
      const txnId = data.transactionId

      const requestUri =
        `${VERIFY_BASE_URL}/v1/verify/vp-request/${requestId}`

      const deepLink =
        `openid4vp://authorize?client_id=${encodeURIComponent(CLIENT_ID)}` +
        `&request_uri=${encodeURIComponent(requestUri)}`

      window.location.href = deepLink

      pollStatus(requestId, txnId)

    } catch (err) {

      console.error(err)
      setMessageColor("red")
      setMessage("Verification failed")

    }
  }


  return (
    <div
      style={{
        maxWidth: "420px",
        margin: "auto",
        padding: "20px",
        textAlign: "center",
        fontFamily: "system-ui"
      }}
    >

      <h2 style={{ marginBottom: "25px" }}>
        Age Verification
      </h2>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px"
        }}
      >

        <button
          onClick={startQRVerification}
          style={{
            padding: "14px",
            fontSize: "16px",
            borderRadius: "8px",
            border: "none",
            background: "#2563eb",
            color: "white",
            cursor: "pointer"
          }}
        >
          Start QR Verification
        </button>

        <button
          onClick={openWalletVerification}
          style={{
            padding: "14px",
            fontSize: "16px",
            borderRadius: "8px",
            border: "none",
            background: "#16a34a",
            color: "white",
            cursor: "pointer"
          }}
        >
          Open Wallet for Verification
        </button>

      </div>

      <div style={{ marginTop: "30px" }}>
        {showQR && (
          <canvas
            ref={canvasRef}
            style={{
              maxWidth: "100%",
              height: "auto"
            }}
          />
        )}
      </div>

      {message && (
        <h2
          style={{
            color: messageColor,
            fontSize: "28px",
            fontWeight: "bold",
            marginTop: "25px"
          }}
        >
          {message}
        </h2>
      )}

    </div>
  )
}

export default VerifyQR
