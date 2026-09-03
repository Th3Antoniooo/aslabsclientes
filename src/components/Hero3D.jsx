import { useEffect, useRef } from 'react'
import * as THREE from 'three'

// Objeto 3D: esfera wireframe con partículas orbitando — molécula/planeta agro
export default function Hero3D() {
  const mountRef = useRef(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const w = mount.clientWidth
    const h = mount.clientHeight

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 100)
    camera.position.z = 6

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(w, h)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.appendChild(renderer.domElement)

    // Núcleo icosaédrico wireframe
    const geo = new THREE.IcosahedronGeometry(1.7, 1)
    const mat = new THREE.MeshBasicMaterial({ color: 0x00ff9d, wireframe: true, transparent: true, opacity: 0.55 })
    const core = new THREE.Mesh(geo, mat)
    scene.add(core)

    // Núcleo interior sólido tenue
    const innerGeo = new THREE.IcosahedronGeometry(1.15, 0)
    const innerMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, wireframe: true, transparent: true, opacity: 0.25 })
    const inner = new THREE.Mesh(innerGeo, innerMat)
    scene.add(inner)

    // Partículas orbitando
    const pCount = 900
    const positions = new Float32Array(pCount * 3)
    for (let i = 0; i < pCount; i++) {
      const r = 2.4 + Math.random() * 2.6
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
      positions[i * 3 + 2] = r * Math.cos(phi)
    }
    const pGeo = new THREE.BufferGeometry()
    pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const pMat = new THREE.PointsMaterial({ color: 0x5cffc4, size: 0.035, transparent: true, opacity: 0.8 })
    const particles = new THREE.Points(pGeo, pMat)
    scene.add(particles)

    // Anillo
    const ringGeo = new THREE.RingGeometry(2.6, 2.65, 64)
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ff9d, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.rotation.x = Math.PI / 2.4
    scene.add(ring)

    let mx = 0, my = 0
    const onMove = (e) => {
      const rect = mount.getBoundingClientRect()
      mx = ((e.clientX - rect.left) / rect.width - 0.5) * 0.6
      my = ((e.clientY - rect.top) / rect.height - 0.5) * 0.6
    }
    mount.addEventListener('mousemove', onMove)

    let raf
    const clock = new THREE.Clock()
    const animate = () => {
      const t = clock.getElapsedTime()
      core.rotation.y = t * 0.3
      core.rotation.x = t * 0.15
      inner.rotation.y = -t * 0.4
      particles.rotation.y = t * 0.06
      ring.rotation.z = t * 0.2
      camera.position.x += (mx * 2 - camera.position.x) * 0.05
      camera.position.y += (-my * 2 - camera.position.y) * 0.05
      camera.lookAt(scene.position)
      renderer.render(scene, camera)
      raf = requestAnimationFrame(animate)
    }
    animate()

    const onResize = () => {
      const nw = mount.clientWidth, nh = mount.clientHeight
      camera.aspect = nw / nh
      camera.updateProjectionMatrix()
      renderer.setSize(nw, nh)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      mount.removeEventListener('mousemove', onMove)
      renderer.dispose()
      geo.dispose(); mat.dispose(); pGeo.dispose(); pMat.dispose()
      if (renderer.domElement.parentNode) mount.removeChild(renderer.domElement)
    }
  }, [])

  return <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
}
