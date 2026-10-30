import React, { useState } from 'react'

const Login = ({ handleLogin }) => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const submitHandler = (e) => {
    e.preventDefault()
    handleLogin(email, password)
    setEmail('')
    setPassword('')
  }

  return (
    <div className='min-h-screen bg-[#090909] flex items-center justify-center px-4'>
      <div className='w-full max-w-6xl overflow-hidden rounded-[32px] border border-orange-500/20 shadow-[0_40px_120px_rgba(0,0,0,0.45)]'>
        <div className='grid gap-0 md:grid-cols-2'>
          <div className='bg-[#151515] px-8 py-10 md:px-12 md:py-16'>
            <div className='mb-10'>
              <p className='text-sm uppercase tracking-[0.3em] text-orange-300'>Login</p>
              <h1 className='mt-4 text-4xl font-semibold text-white'>Welcome back</h1>
              <p className='mt-3 max-w-sm text-sm text-gray-400'>Please enter your credentials to access the employee management dashboard.</p>
            </div>

            <form onSubmit={submitHandler} className='space-y-6'>
              <div>
                <label className='mb-2 block text-sm font-medium text-gray-300'>Username</label>
                <div className='flex items-center gap-3 rounded-full border border-gray-700 bg-[#111111] px-4 py-3 focus-within:border-orange-400'>
                  <span className='text-orange-400'>👤</span>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    type='email'
                    placeholder='example@ems.com'
                    className='w-full bg-transparent text-base text-white outline-none placeholder:text-gray-500'
                  />
                </div>
              </div>

              <div>
                <label className='mb-2 block text-sm font-medium text-gray-300'>Password</label>
                <div className='flex items-center gap-3 rounded-full border border-gray-700 bg-[#111111] px-4 py-3 focus-within:border-orange-400'>
                  <span className='text-orange-400'>🔒</span>
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    type='password'
                    placeholder='Enter your password'
                    className='w-full bg-transparent text-base text-white outline-none placeholder:text-gray-500'
                  />
                </div>
              </div>

              <button className='w-full rounded-full bg-gradient-to-r from-orange-500 via-orange-600 to-orange-400 py-3 text-lg font-semibold text-white shadow-lg shadow-orange-500/20 transition hover:brightness-110'>
                Login
              </button>
            </form>

            <div className='mt-8 text-center text-sm text-gray-400'>
              Don't have an account? <span className='cursor-pointer text-orange-400 hover:text-orange-300'>Sign Up</span>
            </div>
          </div>

          <div className='relative overflow-hidden bg-gradient-to-br from-[#1f1b18] via-[#2c1a14] to-[#d35400] px-8 py-10 md:px-12 md:py-16'>
            <div className='absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(255,255,255,0.08),_transparent_30%)] opacity-80' />
            <div className='relative flex h-full flex-col justify-center text-white'>
              <p className='text-sm uppercase tracking-[0.4em] text-orange-100/80'>Welcome Back!</p>
              <h2 className='mt-6 text-4xl font-bold leading-tight'>We are happy to have you with us again.</h2>
              <p className='mt-5 max-w-lg text-base text-orange-100/90'>If you need anything, we are here to help. Log in to manage tasks, track progress, and stay connected with your team.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Login