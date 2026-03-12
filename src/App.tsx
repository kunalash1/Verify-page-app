import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import VerifyQR from "./VerifyQR"


function App() {
  const [count, setCount] = useState(0)

  return (
    <>
    <div>

      <h1>verify your age</h1>

      <VerifyQR />
      </div>
    </>
  )
}

export default App
