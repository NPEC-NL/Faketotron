import React, { useState } from 'react'
import leafPng from './assets/leaf.png'
import './FallingLeafButton.css'

interface FallingLeafButtonProps {
  onClick?: () => void
  size?: number
}

export default function FallingLeafButton({ onClick, size = 40 }: FallingLeafButtonProps) {
  const [falling, setFalling] = useState(false)

  const handleClick = () => {
    setFalling(true)
    onClick?.()
  }

  const handleAnimationEnd: React.AnimationEventHandler<HTMLImageElement> = () => {
    // Reset to original position so it can fall again on next click
    setFalling(false)
  }

  return (
    <button className="leaf-btn" type="button" onClick={handleClick}>
      <img
        src={leafPng}
        alt="Leaf"
        className={`leaf-img ${falling ? 'leaf-fall' : ''}`}
        onAnimationEnd={handleAnimationEnd}
        style={{ width: size, height: size }}
      />
    </button>
  )
}
