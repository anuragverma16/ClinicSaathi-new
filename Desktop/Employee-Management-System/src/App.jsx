import React, { useContext, useEffect, useState } from 'react'
import Login from './components/Auth/Login'
import EmployeeDashboard from './components/Dashboard/Employee.Dashboard'
import AdminDashboard from './components/Dashboard/Admin.Dashboard'
import { getLocalStroage, setLocalStroage } from './utils/LocalStorage'
import { AuthContext } from './context/AuthProvider'

const App = () => {
  const [user, setUser]= useState(null)
  const[loggedInUserData, setLoggedInUserData]= useState(null)
  
  const [userData, setUserData] = useContext(AuthContext)
  // console.log(authData)

  useEffect(() => {
    const loggedInUser = localStorage.getItem('loggedInUser')
    if (loggedInUser) {
      try {
        const parsed = JSON.parse(loggedInUser)
        setUser(parsed.role)
        setLoggedInUserData(parsed.data)
      } catch (err) {
        console.warn('Failed to parse loggedInUser from localStorage:', err)
        // Remove malformed value so future reads don't throw
        localStorage.removeItem('loggedInUser')
      }
    } else {
      // Only set local storage if there is no logged-in user
      setLocalStroage()
    }
  }, [])

  const handleLogin= (email, password)=>{
    if(email == 'admin@example.com' && password == '123'){
      setUser('admin')
      localStorage.setItem('loggedInUser', JSON.stringify({role:'admin'}))
    }else if(userData){
      const employee = Array.isArray(userData) ? userData.find( (e) => email == e.email && password == e.password ) : undefined
      if(employee){
        setUser('employee')
        setLoggedInUserData(employee)
        localStorage.setItem('loggedInUser', JSON.stringify({role:'employee', data: employee}))
      }
    }else{
      alert("Invalid Credentials")
    }
  }

  useEffect(() => {
    const stored = localStorage.getItem("loggedInUser");
    if (!stored) return;
    try {
      const user = JSON.parse(stored);
      if (user && user.data) {
        const firstName = user.data.firstName;
        const employee = Array.isArray(userData) ? userData.find((e) => e.firstName === firstName) : undefined;
        if (employee) setLoggedInUserData(employee)
      }
    } catch (err) {
      console.warn('Failed to parse loggedInUser from localStorage:', err)
      localStorage.removeItem('loggedInUser')
    }
  }, [userData])

  return (
    <>
      {!user ? <Login handleLogin={handleLogin} />: ''}
      {user == 'admin' ? <AdminDashboard changeUser={setUser} /> : ( user == 'employee' ? <EmployeeDashboard changeUser={setUser} data={loggedInUserData} /> : null)}
    </>
  )
}

export default App