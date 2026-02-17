import { useState, useEffect } from 'react';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

export default function CaptureForm() {
  const [step, setStep] = useState('form');
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    zip: '',
    bookingSource: null,
    isLocal: null,
    playFrequency: null,
    memberElsewhere: null,
    firstTime: null
  });
  const [rewardInfo, setRewardInfo] = useState({
    description: 'Free beer after your round',
    emoji: '🍺'
  });
  const [maskedEmail, setMaskedEmail] = useState('');
  const [errors, setErrors] = useState({});
  const [emailSuggestion, setEmailSuggestion] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [resendStatus, setResendStatus] = useState('');
  const [locationId, setLocationId] = useState(null);
  const [chosenReward, setChosenReward] = useState(null);

  const rewardOptions = [
    { value: 'free_beer', label: 'Free Beer', emoji: '🍺', description: 'A cold one after your round' },
    { value: 'free_soft_drink', label: 'Free Soft Drink', emoji: '🥤', description: 'Any fountain drink or water' },
    { value: 'pro_shop_5', label: '$5 Pro Shop Credit', emoji: '🏌️', description: 'Toward any pro shop purchase' },
    { value: 'food_bev_5', label: '$5 Food & Bev Credit', emoji: '🍔', description: 'At the clubhouse restaurant' }
  ];

  // Get location from URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const loc = params.get('location');
    if (loc) setLocationId(loc);
  }, []);

  const checkEmailTypo = (email) => {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) return null;
    const fixes = {
      'gmail.con': 'gmail.com', 'gmail.co': 'gmail.com', 'gmial.com': 'gmail.com',
      'gmal.com': 'gmail.com', 'gmaill.com': 'gmail.com', 'gmil.com': 'gmail.com',
      'gnail.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmai.com': 'gmail.com',
      'yahoo.con': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com',
      'yhoo.com': 'yahoo.com', 'yhaoo.com': 'yahoo.com',
      'hotmail.con': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmial.com': 'hotmail.com',
      'hotmai.com': 'hotmail.com', 'hitmail.com': 'hotmail.com',
      'outlook.con': 'outlook.com', 'outlok.com': 'outlook.com',
      'icloud.con': 'icloud.com', 'icoud.com': 'icloud.com', 'iclould.com': 'icloud.com',
      'aol.con': 'aol.com', 'comcast.con': 'comcast.net',
    };
    const suggestion = fixes[domain];
    if (suggestion) return email.split('@')[0] + '@' + suggestion;
    return null;
  };

  const validateForm = () => {
    const newErrors = {};
    if (!formData.firstName.trim()) newErrors.firstName = 'Required';
    if (!formData.lastName.trim()) newErrors.lastName = 'Required';
    if (!formData.email.trim()) {
      newErrors.email = 'Required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Invalid email';
    } else {
      const suggestion = checkEmailTypo(formData.email);
      if (suggestion && emailSuggestion !== 'dismissed') {
        setEmailSuggestion(suggestion);
        newErrors.email = 'Check your email address';
      }
    }
    if (!formData.phone.trim()) {
      newErrors.phone = 'Required';
    } else if (formData.phone.replace(/\D/g, '').length < 10) {
      newErrors.phone = 'Invalid phone';
    }
    if (!formData.bookingSource) newErrors.bookingSource = 'Please select one';
    if (formData.isLocal === null) newErrors.isLocal = 'Please select one';
    if (!chosenReward) newErrors.chosenReward = 'Pick your reward!';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const formatPhone = (value) => {
    const numbers = value.replace(/\D/g, '');
    if (numbers.length <= 3) return numbers;
    if (numbers.length <= 6) return `(${numbers.slice(0, 3)}) ${numbers.slice(3)}`;
    return `(${numbers.slice(0, 3)}) ${numbers.slice(3, 6)}-${numbers.slice(6, 10)}`;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    
    setStep('submitting');
    setSubmitError('');

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(`${API_URL}/api/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          courseSlug: 'crescent-pointe',
          locationId,
          firstName: formData.firstName,
          lastName: formData.lastName,
          email: formData.email,
          phone: formData.phone,
          zip: formData.zip,
          bookingSource: formData.bookingSource,
          isLocal: formData.isLocal,
          playFrequency: formData.playFrequency,
          memberElsewhere: formData.memberElsewhere,
          firstTime: formData.firstTime,
          chosenReward
        })
      });
      clearTimeout(timeout);

      if (!response.ok && response.status === 429) {
        throw new Error('Too many attempts. Please wait a few minutes and try again.');
      }

      const data = await response.json();

      if (data.success) {
        setMaskedEmail(data.maskedEmail || '');
        setRewardInfo({
          description: data.rewardDescription || 'Free beer after your round',
          emoji: data.rewardEmoji || '🍺'
        });
        setStep('success');
      } else if (data.error === 'already_claimed') {
        setStep('already_claimed');
      } else {
        throw new Error(data.error || 'Something went wrong');
      }
    } catch (error) {
      console.error('Capture error:', error);
      setStep('form');
      if (error.name === 'AbortError') {
        setSubmitError('Request timed out. Please check your connection and try again.');
      } else {
        setSubmitError(error.message || 'Something went wrong. Please try again.');
      }
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'phone') {
      setFormData({ ...formData, phone: formatPhone(value) });
    } else {
      setFormData({ ...formData, [name]: value });
    }
    if (errors[name]) setErrors({ ...errors, [name]: null });
    if (name === 'email') setEmailSuggestion('');
  };

  const selectOption = (field, value) => {
    setFormData({ ...formData, [field]: value });
    if (errors[field]) setErrors({ ...errors, [field]: null });
  };

  if (step === 'form' || step === 'submitting') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-800 to-green-900 flex flex-col">
        <div className="bg-green-900/50 px-6 py-4 text-center">
          <h1 className="text-xl font-bold text-white">Crescent Pointe</h1>
          <p className="text-green-200 mt-1 text-sm">Pick a free reward on us!</p>
        </div>
        
        <div className="flex-1 px-4 py-3 overflow-auto">
          <div className="bg-white rounded-2xl shadow-xl p-4 max-w-md mx-auto">
            <p className="text-gray-500 text-sm mb-3 text-center">
              Join our list. Takes 30 seconds.
            </p>
            
            {submitError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
                <p className="text-red-700 text-sm text-center">{submitError}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">First Name</label>
                  <input
                    type="text"
                    name="firstName"
                    value={formData.firstName}
                    onChange={handleChange}
                    className={`w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none ${errors.firstName ? 'border-red-400' : 'border-gray-300'}`}
                    placeholder="John"
                    disabled={step === 'submitting'}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Last Name</label>
                  <input
                    type="text"
                    name="lastName"
                    value={formData.lastName}
                    onChange={handleChange}
                    className={`w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none ${errors.lastName ? 'border-red-400' : 'border-gray-300'}`}
                    placeholder="Smith"
                    disabled={step === 'submitting'}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  className={`w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none ${errors.email ? 'border-red-400' : 'border-gray-300'}`}
                  placeholder="john@example.com"
                  disabled={step === 'submitting'}
                />
                {emailSuggestion && emailSuggestion !== 'dismissed' && (
                  <div className="mt-1 bg-amber-50 border border-amber-200 rounded-lg p-2 flex items-center justify-between">
                    <p className="text-xs text-amber-800">
                      Did you mean <strong>{emailSuggestion}</strong>?
                    </p>
                    <div className="flex gap-2 ml-2">
                      <button
                        type="button"
                        onClick={() => {
                          setFormData({ ...formData, email: emailSuggestion });
                          setEmailSuggestion('');
                          setErrors({ ...errors, email: null });
                        }}
                        className="text-xs font-medium text-green-700 bg-green-100 px-2 py-1 rounded hover:bg-green-200"
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEmailSuggestion('dismissed');
                          setErrors({ ...errors, email: null });
                        }}
                        className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded hover:bg-gray-200"
                      >
                        No
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  className={`w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none ${errors.phone ? 'border-red-400' : 'border-gray-300'}`}
                  placeholder="(555) 123-4567"
                  disabled={step === 'submitting'}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Zip Code</label>
                <input
                  type="text"
                  name="zip"
                  value={formData.zip}
                  onChange={handleChange}
                  maxLength={5}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
                  placeholder="12345"
                  disabled={step === 'submitting'}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">How did you book today?</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {[
                    { value: 'golfnow', label: 'GolfNow' },
                    { value: 'website', label: 'Website' },
                    { value: 'phone', label: 'Phone' },
                    { value: 'walkin', label: 'Walk-in' }
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => selectOption('bookingSource', option.value)}
                      className={`py-2 rounded-lg border-2 text-xs font-medium transition ${
                        formData.bookingSource === option.value
                          ? 'border-green-600 bg-green-50 text-green-700'
                          : 'border-gray-300 text-gray-600'
                      }`}
                      disabled={step === 'submitting'}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Are you local or visiting?</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => selectOption('isLocal', true)}
                    className={`py-2 rounded-lg border-2 text-sm font-medium transition ${
                      formData.isLocal === true
                        ? 'border-green-600 bg-green-50 text-green-700'
                        : 'border-gray-300 text-gray-600'
                    }`}
                    disabled={step === 'submitting'}
                  >
                    Local
                  </button>
                  <button
                    type="button"
                    onClick={() => selectOption('isLocal', false)}
                    className={`py-2 rounded-lg border-2 text-sm font-medium transition ${
                      formData.isLocal === false
                        ? 'border-green-600 bg-green-50 text-green-700'
                        : 'border-gray-300 text-gray-600'
                    }`}
                    disabled={step === 'submitting'}
                  >
                    Visiting
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">How often do you play golf?</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {[
                    { value: 'rarely', label: 'Few times/year' },
                    { value: 'monthly', label: 'Monthly' },
                    { value: 'weekly', label: 'Weekly+' }
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => selectOption('playFrequency', option.value)}
                      className={`py-2 rounded-lg border-2 text-xs font-medium transition ${
                        formData.playFrequency === option.value
                          ? 'border-green-600 bg-green-50 text-green-700'
                          : 'border-gray-300 text-gray-600'
                      }`}
                      disabled={step === 'submitting'}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Member at another club?</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => selectOption('memberElsewhere', true)}
                    className={`py-2 rounded-lg border-2 text-sm font-medium transition ${
                      formData.memberElsewhere === true
                        ? 'border-green-600 bg-green-50 text-green-700'
                        : 'border-gray-300 text-gray-600'
                    }`}
                    disabled={step === 'submitting'}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => selectOption('memberElsewhere', false)}
                    className={`py-2 rounded-lg border-2 text-sm font-medium transition ${
                      formData.memberElsewhere === false
                        ? 'border-green-600 bg-green-50 text-green-700'
                        : 'border-gray-300 text-gray-600'
                    }`}
                    disabled={step === 'submitting'}
                  >
                    No
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">First time at Crescent Pointe?</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => selectOption('firstTime', true)}
                    className={`py-2 rounded-lg border-2 text-sm font-medium transition ${
                      formData.firstTime === true
                        ? 'border-green-600 bg-green-50 text-green-700'
                        : 'border-gray-300 text-gray-600'
                    }`}
                    disabled={step === 'submitting'}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => selectOption('firstTime', false)}
                    className={`py-2 rounded-lg border-2 text-sm font-medium transition ${
                      formData.firstTime === false
                        ? 'border-green-600 bg-green-50 text-green-700'
                        : 'border-gray-300 text-gray-600'
                    }`}
                    disabled={step === 'submitting'}
                  >
                    No
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Pick your reward!</label>
                {errors.chosenReward && <p className="text-xs text-red-500 mb-1">{errors.chosenReward}</p>}
                <div className="grid grid-cols-2 gap-2">
                  {rewardOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setChosenReward(option.value);
                        if (errors.chosenReward) setErrors({ ...errors, chosenReward: null });
                      }}
                      className={`p-3 rounded-lg border-2 text-left transition ${
                        chosenReward === option.value
                          ? 'border-green-600 bg-green-50'
                          : errors.chosenReward
                            ? 'border-red-300'
                            : 'border-gray-300'
                      }`}
                      disabled={step === 'submitting'}
                    >
                      <span className="text-xl block mb-1">{option.emoji}</span>
                      <span className={`text-xs font-semibold block ${
                        chosenReward === option.value ? 'text-green-700' : 'text-gray-800'
                      }`}>{option.label}</span>
                      <span className="text-xs text-gray-500 block">{option.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={step === 'submitting'}
                className="w-full bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-semibold py-3 rounded-lg transition flex items-center justify-center gap-2 mt-2"
              >
                {step === 'submitting' ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Getting your code...
                  </>
                ) : (
                  'Claim My Reward'
                )}
              </button>
            </form>
            
            <p className="text-xs text-gray-400 text-center mt-2">
              We'll send occasional updates. Unsubscribe anytime.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Already claimed screen
  if (step === 'already_claimed') {
    const handleResend = async () => {
      setResendStatus('sending');
      try {
        const response = await fetch(`${API_URL}/api/rewards/resend`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: formData.email })
        });
        if (response.ok) {
          setResendStatus('sent');
        } else {
          setResendStatus('error');
        }
      } catch {
        setResendStatus('error');
      }
    };

    return (
      <div className="min-h-screen bg-gradient-to-b from-amber-600 to-amber-700 flex flex-col">
        <div className="bg-amber-800/50 px-6 py-5 text-center">
          <h1 className="text-xl font-bold text-white">Crescent Pointe</h1>
        </div>

        <div className="flex-1 px-4 py-6 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md mx-auto text-center">
            <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">👋</span>
            </div>

            <h2 className="text-xl font-bold text-gray-800 mb-1">Welcome back!</h2>
            <p className="text-gray-500 text-sm mb-4">You've already claimed your reward.</p>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
              <p className="text-amber-800 text-sm">
                Check your email for your reward code. Can't find it?
              </p>
            </div>

            {resendStatus === 'sent' ? (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <p className="text-green-700 text-sm font-medium">Reward code resent! Check your inbox.</p>
              </div>
            ) : (
              <button
                onClick={handleResend}
                disabled={resendStatus === 'sending'}
                className="w-full bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white font-medium py-2.5 rounded-lg text-sm transition"
              >
                {resendStatus === 'sending' ? 'Sending...' : resendStatus === 'error' ? 'Try Again' : 'Resend My Code'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Success screen (new claim) — code sent to email, not shown on screen
  return (
    <div className="min-h-screen bg-gradient-to-b from-green-800 to-green-900 flex flex-col">
      <div className="bg-green-900/50 px-6 py-5 text-center">
        <h1 className="text-xl font-bold text-white">Crescent Pointe</h1>
      </div>

      <div className="flex-1 px-4 py-6 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md mx-auto text-center">
          <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <h2 className="text-xl font-bold text-gray-800 mb-1">You're in!</h2>
          <p className="text-gray-500 text-sm mb-4">We sent your reward code to:</p>

          <div className="bg-gray-100 rounded-xl p-4 mb-4">
            <div className="flex items-center justify-center gap-2 mb-1">
              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <p className="text-lg font-semibold text-gray-800">{maskedEmail}</p>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
            <p className="text-amber-800 font-semibold flex items-center justify-center gap-2">
              <span className="text-xl">{rewardInfo.emoji}</span> {rewardInfo.description}
            </p>
            <p className="text-amber-600 text-sm">Valid today only</p>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-200 space-y-2">
            <p className="text-sm text-gray-600">
              Open your email and show the code to any staff member.
            </p>
            <p className="text-xs text-gray-400">
              Don't see it? Check your spam folder.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
