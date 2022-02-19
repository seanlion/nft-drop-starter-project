import React from 'react';
import './CountdownTimer.css';

const CountdownTimer = ({ dropDate, timerString }) => {
  // State

  return (
    <div className="timer-container">
      <p className="timer-header">Candy Drop Starting In</p>
      {timerString && <p className="timer-value">{`⏰ ${timerString}`}</p>}
    </div>
  );
};

export default CountdownTimer;