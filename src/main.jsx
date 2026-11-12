import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import QRCode from "qrcode";
import {
  ArrowUpRight,
  ArrowRight,
  MapPin,
  Clock,
  Check,
  ShieldCheck,
  Sun,
  Lightbulb,
  Car,
  Users,
  Menu,
  X,
  ChevronRight,
  ChevronLeft,
  Star,
  Mail,
  CalendarDays,
  Trophy,
  Download,
  Camera,
  QrCode,
} from "lucide-react";
import "./style.css";
const configured = !!(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
);
const db = configured
  ? createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY,
    )
  : null;
const photo =
  "https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?auto=format&fit=crop&w=1800&q=85";
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
    new Date(),
  );
const nextBookableTime = () => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const minutes = Math.ceil((parts.hour * 60 + parts.minute + 1) / 30) * 30;
  return minutes > 22 * 60 + 30
    ? "23:59"
    : `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
};
const bookingQrPayload = (reference) => `nigamsturf:booking:${reference}`;
function App() {
  const [date, setDate] = useState(today()),
    [duration, setDuration] = useState(60),
    [time, setTime] = useState(null),
    [slots, setSlots] = useState([]),
    [loading, setLoading] = useState(false),
    [modal, setModal] = useState(null),
    [menu, setMenu] = useState(false),
    [message, setMessage] = useState(""),
    [session, setSession] = useState(null),
    [bookings, setBookings] = useState([]),
    [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [codeSent, setCodeSent] = useState(false),
    [authMethod, setAuthMethod] = useState("email"),
    [name, setName] = useState(""),
    [phone, setPhone] = useState(""),
    [coupon, setCoupon] = useState(""),
    [hold, setHold] = useState(null),
    [bookingConfirmation, setBookingConfirmation] = useState(null),
    [bookingQr, setBookingQr] = useState(""),
    [busy, setBusy] = useState(false);
  const [adminId, setAdminId] = useState(""),
    [adminPassword, setAdminPassword] = useState(""),
    [adminData, setAdminData] = useState(null),
    [ownerOpen, setOwnerOpen] = useState(false),
    [scanning, setScanning] = useState(false),
    [scanReference, setScanReference] = useState(""),
    [scannedBooking, setScannedBooking] = useState(null),
    [adminForm, setAdminForm] = useState({
      date: today(),
      start: "05:00",
      duration: 60,
      name: "",
      mobile: "",
      payment_method: "cash",
      reason: "Owner block",
    });
  const scannerRef = useRef(null);
  const price = Math.floor(duration / 60) * 1200 + (duration % 60 ? 700 : 0);
  const displayedSlots = (
    configured
      ? slots
      : Array.from({ length: 36 }, (_, i) => ({
          start_time: `${String(5 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`,
          status: "preview",
        }))
  )
    .filter((s) => {
      const start =
        Number(s.start_time.slice(0, 2)) * 60 +
        Number(s.start_time.slice(3, 5));
      return start >= 300 && start + duration <= 1380;
    })
    .map((s) => ({
      ...s,
      status:
        configured &&
        s.status === "available" &&
        Array.from({ length: duration / 30 }, (_, i) => {
          const start =
            Number(s.start_time.slice(0, 2)) * 60 +
            Number(s.start_time.slice(3, 5)) +
            i * 30;
          return slots.find(
            (x) =>
              Number(x.start_time.slice(0, 2)) * 60 +
                Number(x.start_time.slice(3, 5)) ===
              start,
          )?.status;
        }).some((status) => status !== "available")
          ? "unavailable"
          : s.status,
    }));
  useEffect(() => {
    if (!db) return;
    db.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = db.auth.onAuthStateChange((_, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  async function refresh() {
    if (!db) return;
    setLoading(true);
    const { data, error } = await db.rpc("available_slots", { p_date: date });
    setSlots(data || []);
    setMessage(error?.message || "");
    setLoading(false);
  }
  useEffect(() => {
    setTime(null);
    refresh();
    if (!db) return;
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, [date]);
  useEffect(() => {
    if (!scanning || !ownerOpen || !adminData) return;
    let cancelled = false;
    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled) return;
        const scanner = new Html5Qrcode("admin-qr-reader");
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 230, height: 230 } },
          (decodedText) => {
            findScannedBooking(decodedText);
            setScanning(false);
          },
          () => {},
        );
      } catch (error) {
        setScanning(false);
        setMessage(
          error?.message ||
            "The camera could not start. Allow camera access or enter the booking reference manually.",
        );
      }
    })();
    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      scannerRef.current = null;
      if (scanner) scanner.stop().catch(() => {}).finally(() => scanner.clear());
    };
  }, [scanning, ownerOpen, adminData]);
  function open(m) {
    setMessage("");
    setMenu(false);
    if (m === "admin") {
      setOwnerOpen(true);
      if (adminData) loadAdmin();
      return;
    }
    setModal(m);
    if (m === "bookings") loadBookings(m);
  }
  async function loadBookings(m) {
    if (!db || !session) return;
    const { data, error } = await db
      .from("bookings")
      .select("*")
      .order("created_at", { ascending: false });
    setBookings(data || []);
    if (error) setMessage(error.message);
  }
  async function login(e) {
    e.preventDefault();
    if (!db) {
      setMessage(
        "Online sign-in will be available once Supabase is connected.",
      );
      return;
    }
    setBusy(true);
    if (codeSent) {
      const destination = authMethod === "phone" ? `+91${phone}` : email;
      const { error } = await db.auth.verifyOtp(
        authMethod === "phone"
          ? { phone: destination, token: code.trim(), type: "sms" }
          : { email: destination, token: code.trim(), type: "email" },
      );
      setBusy(false);
      if (error) {
        setMessage(error.message);
        return;
      }
      setCode("");
      setCodeSent(false);
      setMessage("");
      setModal(null);
      return;
    }
    const destination = authMethod === "phone" ? `+91${phone}` : email;
    const { error } = await db.auth.signInWithOtp(
      authMethod === "phone"
        ? { phone: destination, options: { data: { name, mobile: phone, email_contact: email } } }
        : { email: destination, options: { data: { name, mobile: phone } } },
    );
    setBusy(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setCodeSent(true);
    setMessage(
      authMethod === "phone"
        ? `SMS sent successfully. Enter the verification code sent to +91 ${phone}.`
        : `Email sent successfully. Enter the verification code sent to ${email}.`,
    );
  }
  async function checkout(e) {
    e.preventDefault();
    if (!db) {
      setMessage(
        "Online booking is not open yet. No slot has been reserved and no payment will be collected.",
      );
      return;
    }
    if (!session) {
      open("login");
      return;
    }
    setBusy(true);
    const { data, error } = await db.functions.invoke("checkout", {
      body: {
        date,
        start: time.start_time,
        duration,
        name,
        mobile: phone,
        coupon,
      },
    });
    setBusy(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setHold(data);
    const releaseUnpaidHold = async (message) => {
      const result = await db.functions.invoke("release-booking", {
        body: { order_id: data.order_id },
      });
      setHold(null);
      setMessage(
        result.error
          ? "Checkout closed. The reservation will expire automatically shortly."
          : message,
      );
      refresh();
    };
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => {
      const checkoutWindow = new window.Razorpay({
        key: data.key_id,
        order_id: data.order_id,
        amount: data.amount,
        currency: "INR",
        name: "Nigam's Turf",
        prefill: { name, email: session.user.email, contact: phone },
        handler: async (response) => {
          setMessage("Verifying your payment…");
          const result = await db.functions.invoke("verify-payment", {
            body: response,
          });
          if (result.error) {
            setMessage("Payment verification is pending. Check My bookings before retrying.");
          } else {
            const confirmation = result.data.booking || {
              reference: result.data.reference,
              booking_date: date,
              start_time: time.start_time,
              duration_minutes: duration,
              customer_name: name,
              mobile: phone,
              amount_paise: data.amount,
            };
            setBookingConfirmation(confirmation);
            setBookingQr(
              await QRCode.toDataURL(bookingQrPayload(confirmation.reference), {
                width: 280,
                margin: 2,
                color: { dark: "#173e2b", light: "#ffffff" },
              }),
            );
            setModal("confirmation");
            setMessage("Payment confirmed. A confirmation email with your booking QR code and invoice has been sent.");
          }
          refresh();
        },
        modal: {
          ondismiss: () =>
            releaseUnpaidHold(
              "Payment cancelled. The time slot is available again.",
            ),
        },
      });
      checkoutWindow.on("payment.failed", () =>
        releaseUnpaidHold(
          "Payment failed. The time slot is available again.",
        ),
      );
      checkoutWindow.open();
    };
    script.onerror = () =>
      releaseUnpaidHold(
        "Payment service could not load. The time slot is available again.",
      );
    document.body.appendChild(script);
  }
  async function cancel(b) {
    setBusy(true);
    const { error } = await db.functions.invoke("cancel-booking", {
      body: { booking_id: b.id },
    });
    setBusy(false);
    setMessage(
      error?.message ||
        "Cancellation requested. Refund status will appear on your booking.",
    );
    loadBookings();
  }
  async function loadAdmin() {
    const { data, error } = await db.rpc("admin_dashboard");
    if (error) {
      setAdminData(null);
      setMessage(error.message);
      return false;
    }
    setAdminData(data);
    setMessage("");
    return true;
  }
  async function adminLogin(e) {
    e.preventDefault();
    setBusy(true);
    const adminEmail = `${adminId.trim().toLowerCase()}@nigamsturf.local`;
    const { error } = await db.auth.signInWithPassword({
      email: adminEmail,
      password: adminPassword,
    });
    if (error) {
      setBusy(false);
      setMessage("Invalid administrator ID or password.");
      return;
    }
    const ok = await loadAdmin();
    setBusy(false);
    if (!ok) await db.auth.signOut();
  }
  async function adminCreate(e) {
    e.preventDefault();
    setBusy(true);
    const { error } = await db.rpc("admin_create_booking", {
      p_date: adminForm.date,
      p_start: adminForm.start,
      p_duration: +adminForm.duration,
      p_name: adminForm.name,
      p_mobile: adminForm.mobile,
      p_payment_method: adminForm.payment_method,
    });
    setBusy(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setAdminForm({ ...adminForm, name: "", mobile: "" });
    setMessage("Booking created successfully.");
    await loadAdmin();
    refresh();
  }
  async function adminBlock(fullDay = false) {
    if (!adminForm.reason.trim()) {
      setMessage("Please enter a reason before blocking availability.");
      return;
    }
    if (adminForm.date < today() || (adminForm.date === today() && (fullDay || adminForm.start < nextBookableTime()))) {
      setMessage("Past dates and times cannot be blocked.");
      return;
    }
    setBusy(true);
    const { error } = await db.rpc("admin_block_period", {
      p_date: adminForm.date,
      p_start: fullDay ? "05:00" : adminForm.start,
      p_duration: fullDay ? 1080 : +adminForm.duration,
      p_reason: adminForm.reason,
    });
    setBusy(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage(
      fullDay ? "Day blocked successfully." : "Slot blocked successfully.",
    );
    await loadAdmin();
    refresh();
  }
  async function removeBlock(id) {
    setBusy(true);
    const { error } = await db.rpc("admin_remove_block", { p_block: id });
    setBusy(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage("Block removed.");
    await loadAdmin();
    refresh();
  }
  function findScannedBooking(value) {
    const reference = String(value || "").match(/SBL-CRT-\d{8}-\d{6}/i)?.[0]?.toUpperCase();
    if (!reference) {
      setScannedBooking(null);
      setMessage("This is not a valid Nigam's Turf booking QR code.");
      return;
    }
    const booking = adminData?.bookings?.find(
      (item) => item.reference?.toUpperCase() === reference,
    );
    setScanReference(reference);
    setScannedBooking(booking || null);
    setMessage(
      booking
        ? "Booking QR verified successfully."
        : `No booking was found for ${reference}.`,
    );
  }
  const book = () =>
    document
      .getElementById("booking")
      .scrollIntoView({ behavior: "smooth", block: "center" });
  return (
    <>
      <header>
        <a className="brand" href="#">
          <img
            className="brand-logo"
            src="/nigam-logo.png"
            alt="Nigam Developers logo"
          />
          Nigam's Turf
        </a>
        <nav className={menu ? "open" : ""}>
          <a href="#facilities">The turf</a>
          <a href="#pricing">Pricing</a>
          <a href="#how">How it works</a>
          <a href="#location">
            Find us <ArrowUpRight size={13} />
          </a>
        </nav>
        <div className="nav-right">
          <button
            className="plain"
            onClick={() => open(session ? "bookings" : "login")}
          >
            {session ? "My bookings" : "Log in"}
          </button>
          <button className="green small" onClick={book}>
            Book a slot <ArrowUpRight size={16} />
          </button>
          <button
            className="hamburger plain"
            aria-label="Toggle navigation"
            onClick={() => setMenu(!menu)}
          >
            <Menu />
          </button>
        </div>
      </header>
      <main>
        <section className="hero">
          <img
            className="hero-image"
            src={photo}
            alt="Floodlit cricket stadium with a lush green playing field"
          />
          <div className="hero-shade" />
          <div className="hero-content">
            <div className="eyebrow">
              <span /> SAMBALPUR’S NEW HOME OF CRICKET
            </div>
            <h1>
              Less scrolling.
              <br />
              More <em>scoring.</em>
            </h1>
            <p>
              Your squad. A perfect pitch. A game worth showing up for.
              <br className="desktop" /> Book your next innings at Nigam's Turf.
            </p>
            <button className="lime" onClick={book}>
              Let’s play <ArrowUpRight size={19} />
            </button>
            <div className="hero-bottom">
              <span>
                <MapPin size={15} /> Sambalpur, Odisha
              </span>
              <span>
                <Clock size={15} /> 5 AM – 11 PM · Every day
              </span>
            </div>
          </div>
          <div className="hero-stamp">
            <span>BUILT FOR THE</span>
            <Trophy size={29} />
            <span>LOVE OF THE GAME</span>
          </div>
          <div className="image-caption">GOOD TIMES. GREAT INNINGS.</div>
        </section>
        <section id="booking" className="booking">
          <div className="booking-title">
            <div>
              <span className="overline">MAKE TIME FOR YOUR GAME</span>
              <h2>Your next innings starts here.</h2>
            </div>
            <span className="live">
              <i />
              {configured ? "Live availability" : "Booking preview"}
            </span>
          </div>
          <div className="booking-controls">
            <label>
              <span>
                <CalendarDays size={15} /> PICK A DATE
              </span>
              <input
                aria-label="Booking date"
                type="date"
                min={today()}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label>
              <span>
                <Clock size={15} /> PLAY FOR
              </span>
              <select
                value={duration}
                onChange={(e) => {
                  setDuration(+e.target.value);
                  setTime(null);
                }}
              >
                {[60, 90, 120].map((n) => (
                  <option key={n} value={n}>
                    {n / 60} {n === 60 ? "hour" : "hours"}{" "}
                    {n === 60 ? "· A quick innings" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>
                <MapPin size={15} /> YOUR GROUND
              </span>
              <select aria-label="Facility">
                <option>Nigam's Turf · Sambalpur</option>
              </select>
            </label>
          </div>
          <div className="slots-heading">
            <b>
              Choose your starting time <span>IST</span>
            </b>
            <div className="legend">
              <span>
                <i /> Available
              </span>
              <span>
                <i className="booked" /> Booked
              </span>
              <span>
                <i className="held" /> Reserved
              </span>
            </div>
          </div>
          <div className="slots">
            {displayedSlots.map((s) => (
              <button
                key={s.start_time}
                disabled={configured && s.status !== "available"}
                className={`slot ${s.status} ${time?.start_time === s.start_time ? "selected" : ""}`}
                onClick={() => setTime(s)}
              >
                {+s.start_time.slice(0, 2) % 12 || 12}:
                {s.start_time.slice(3, 5)}{" "}
                {+s.start_time.slice(0, 2) < 12 ? "AM" : "PM"}
                {time?.start_time === s.start_time && <Check size={13} />}
              </button>
            ))}
          </div>
          {loading && <p>Checking availability…</p>}
          {configured && !loading && !slots.length && (
            <p>No slots available for this date.</p>
          )}
          <div className="booking-footer">
            <span>
              <ShieldCheck size={16} />{" "}
              {configured
                ? "Secure payments. Instant confirmation."
                : "Explore your next game. Online bookings opening soon."}
            </span>
            <button
              className="green"
              disabled={!time}
              onClick={() => open("checkout")}
            >
              {time
                ? `Continue · ₹${price.toLocaleString("en-IN")}`
                : "Select a time slot"}{" "}
              <ArrowRight size={17} />
            </button>
          </div>
        </section>
        <section className="trust-strip">
          <span>
            <span className="stars">★★★★★</span> Made for cricket lovers
          </span>
          <span>
            <ShieldCheck /> Safe, enclosed playing area
          </span>
          <span>
            <Users /> Bring your whole squad
          </span>
          <span>
            <Sun /> More play. Every day.
          </span>
        </section>
        <section id="facilities" className="facilities section">
          <div className="section-top">
            <div>
              <span className="overline">THE GROUND MAKES THE GAME</span>
              <h2>
                Big game energy.
                <br />
                Everything you need.
              </h2>
            </div>
            <p>
              From the first ball to the last over, we’ve got you covered.
              <br />
              Just bring your team. We’ll take care of the ground.
            </p>
          </div>
          <div className="facility-grid">
            <div className="facility-photo">
              <img
                src="https://images.unsplash.com/photo-1531415074968-036ba1b575da?auto=format&fit=crop&w=1000&q=85"
                alt="Cricket match on a green field"
                loading="lazy"
              />
              <span>
                YOUR HOME GROUND, UPGRADED. <ArrowUpRight />
              </span>
            </div>
            <div className="amenities">
              {[
                [
                  Sun,
                  "Premium playing turf",
                  "A consistent surface. A better game.",
                ],
                [
                  Lightbulb,
                  "Stadium-style floodlights",
                  "Keep the innings going after sundown.",
                ],
                [
                  ShieldCheck,
                  "Fully enclosed nets",
                  "Big shots. A safe space to play.",
                ],
                [
                  Car,
                  "Easy parking & essentials",
                  "Park, hydrate, and get straight to the game.",
                ],
              ].map(([Icon, title, desc]) => (
                <div className="amenity" key={title}>
                  <span>
                    <Icon size={23} />
                  </span>
                  <div>
                    <h3>{title}</h3>
                    <p>{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section id="pricing" className="section pricing">
          <div className="section-top">
            <div>
              <span className="overline">
                A LITTLE LESS PLANNING. A LOT MORE PLAY.
              </span>
              <h2>Pick your kind of innings.</h2>
            </div>
            <span className="muted">Transparent pricing. No surprises.</span>
          </div>
          <div className="packages">
            {[
              [
                "The quick knock",
                "1 hour",
                1200,
                "A little practice. A big refresh.",
              ],
              [
                "The classic innings",
                "1.5 hours",
                1900,
                "More time for the whole squad to play.",
              ],
              [
                "The long game",
                "2 hours",
                2400,
                "Settle in. There’s a match to be won.",
              ],
            ].map(([title, period, cost, desc], i) => (
              <article
                className={i === 1 ? "package featured" : "package"}
                key={title}
              >
                {i === 1 && (
                  <span className="popular">THE SQUAD FAVOURITE</span>
                )}
                <span className="package-number">0{i + 1} /</span>
                <h3>{title}</h3>
                <p>{desc}</p>
                <div className="package-price">
                  ₹{cost.toLocaleString("en-IN")} <span>/ {period}</span>
                </div>
                <button
                  className={i === 1 ? "green" : "outline"}
                  onClick={() => {
                    setDuration([60, 90, 120][i]);
                    setTime(null);
                    book();
                  }}
                >
                  Choose your slot <ArrowUpRight size={17} />
                </button>
              </article>
            ))}
          </div>
          <p className="pricing-note">
            Indicative rates · Final availability, pricing and applicable taxes
            are shown at checkout.
          </p>
        </section>
        <section id="how" className="section how">
          <div>
            <span className="overline">FROM GROUP CHAT TO GAME ON</span>
            <h2>
              Three steps.
              <br />
              Zero excuses.
            </h2>
            <a href="#booking">
              Get your squad together <ArrowUpRight size={17} />
            </a>
          </div>
          {[
            ["01", "Pick your slot", "Find a time that works for your team."],
            ["02", "Make it yours", "Book securely and get your confirmation."],
            [
              "03",
              "Show up. Play on.",
              "Bring the energy. We’ve got the rest.",
            ],
          ].map(([n, t, d]) => (
            <div className="step" key={n}>
              <span>{n}</span>
              <h3>{t}</h3>
              <p>{d}</p>
            </div>
          ))}
        </section>
        <section id="location" className="section location">
          <div>
            <span className="overline">CLOSER TO YOUR NEXT GREAT GAME</span>
            <h2>
              Sambalpur.
              <br />
              See you at the crease.
            </h2>
            <p>
              Your local game deserves a great home ground.
              <br />
              Sambalpur, Odisha, India
            </p>
            <span className="location-hours">
              <Clock size={18} /> Every day · 5:00 AM – 11:00 PM IST
            </span>
            <a
              className="green"
              href="https://www.google.com/maps/place/21%C2%B026'30.3%22N+83%C2%B057'35.9%22E/@21.4417534,83.9574013,17z/data=!3m1!4b1!4m4!3m3!8m2!3d21.4417534!4d83.9599762?hl=en&entry=ttu"
              target="_blank"
              rel="noreferrer"
            >
              Get directions <ArrowUpRight size={17} />
            </a>
            <small>21°26'30.3&quot;N, 83°57'35.9&quot;E</small>
          </div>
          <div className="map">
            <iframe
              title="Nigam's Turf location"
              src="https://maps.google.com/maps?ll=21.4417534%2C83.9599762&t=m&z=17&output=embed"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
            <a
              className="map-link"
              href="https://www.google.com/maps/place/21%C2%B026'30.3%22N+83%C2%B057'35.9%22E/@21.4417534,83.9574013,17z/data=!3m1!4b1!4m4!3m3!8m2!3d21.4417534!4d83.9599762?hl=en&entry=ttu"
              target="_blank"
              rel="noreferrer"
              aria-label="Open Nigam's Turf location in Google Maps"
            >
              <strong className="map-marker">
                <MapPin size={25} /> Nigam's Turf
              </strong>
              <span>
                <MapPin size={16} /> NIGAM'S TURF · OPEN IN MAPS
              </span>
            </a>
          </div>
        </section>
        <section className="section faq">
          <div>
            <span className="overline">BEFORE YOU TAKE GUARD</span>
            <h2>A few things to know.</h2>
          </div>
          <div>
            {[
              [
                "How do I book a turf slot?",
                "Choose a date, duration and available starting time. Enter your details, then complete secure payment. A booking is confirmed only after the server verifies payment.",
              ],
              [
                "Can I bring my own cricket equipment?",
                "Yes, bring your bat, ball and the equipment your squad needs. Check with the venue before arrival for any equipment rental options.",
              ],
              [
                "Can I cancel my booking?",
                "Cancellation eligibility and any refund are shown in My bookings. The final cancellation policy must be configured by the venue before online bookings open.",
              ],
              [
                "What happens if my payment fails?",
                "Your booking will not be confirmed. Any unpaid reservation expires after ten minutes. Check your booking status before trying again.",
              ],
            ].map(([q, a]) => (
              <details key={q}>
                <summary>
                  {q}
                  <span>+</span>
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="cta">
          <div>
            <span className="overline">
              THE GROUP CHAT HAS WAITED LONG ENOUGH.
            </span>
            <h2>See you on the turf.</h2>
          </div>
          <button className="lime" onClick={book}>
            Book your next innings <ArrowUpRight size={20} />
          </button>
        </section>
      </main>
      <footer>
        <a className="brand" href="#">
          <img
            className="brand-logo"
            src="/nigam-logo.png"
            alt="Nigam Developers logo"
          />
          Nigam's Turf
        </a>
        <span>A little competition. A lot of connection.</span>
        <div>
          <button className="plain" onClick={() => open("bookings")}>
            My bookings
          </button>
          <button className="plain" onClick={() => open("admin")}>
            Owner dashboard
          </button>
        </div>
        <p>
          © {new Date().getFullYear()} Nigam\'s Turf · Sambalpur, Odisha{" "}
          <span className="footer-signoff">
            <span>Made for the love of the game.</span>
            <span className="powered-by" aria-label="Powered by Xolnet">
              <small>Powered by</small>
              <img src="/xolnet.png" alt="Xolnet" />
            </span>
          </span>
        </p>
      </footer>
      {ownerOpen && (
        <div className="modal-overlay">
          <section className="modal admin-modal" role="dialog" aria-modal="true" aria-label="Owner dashboard">
            <button className="close plain" aria-label="Close dialog" onClick={() => setOwnerOpen(false)}><X /></button>
            <span className="overline">OWNER WORKSPACE</span><h2>Owner dashboard</h2>
            {!adminData ? (
              <><p>Sign in with your administrator ID and password.</p><form onSubmit={adminLogin}>
                <label>Admin ID<input required value={adminId} onChange={(e) => setAdminId(e.target.value)} autoComplete="username" /></label>
                <label>Password<input required type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} autoComplete="current-password" /></label>
                <button className="green" disabled={busy}>{busy ? "Signing in…" : "Sign in as owner"}<ArrowRight size={17} /></button>
              </form></>
            ) : (
              <>
                <div className="admin-stats"><article><span>Collected revenue</span><strong>₹{(adminData.revenue_paise / 100).toLocaleString("en-IN")}</strong></article><article><span>Confirmed bookings</span><strong>{adminData.confirmed_count}</strong></article></div>
                <div className="admin-grid">
                  <form onSubmit={adminCreate}><h3>Create manual booking</h3>
                    <label>Date<input required type="date" min={today()} value={adminForm.date} onChange={(e) => setAdminForm({ ...adminForm, date: e.target.value })} /></label>
                    <label>Start time<input required type="time" min={adminForm.date === today() ? nextBookableTime() : "05:00"} max="22:30" step="1800" value={adminForm.start} onChange={(e) => setAdminForm({ ...adminForm, start: e.target.value })} /></label>
                    <label>Duration<select value={adminForm.duration} onChange={(e) => setAdminForm({ ...adminForm, duration: +e.target.value })}>{[60, 90, 120].map((n) => <option key={n} value={n}>{n} minutes</option>)}</select></label>
                    <label>Customer name<input required value={adminForm.name} onChange={(e) => setAdminForm({ ...adminForm, name: e.target.value })} /></label>
                    <label>Mobile<input required pattern="[6-9][0-9]{9}" value={adminForm.mobile} onChange={(e) => setAdminForm({ ...adminForm, mobile: e.target.value })} /></label>
                    <label>Payment<select value={adminForm.payment_method} onChange={(e) => setAdminForm({ ...adminForm, payment_method: e.target.value })}><option value="cash">Cash payment</option><option value="complimentary">No payment / complimentary</option></select></label>
                    <button className="green" disabled={busy}>Create booking</button>
                  </form>
                  <div><h3>Block availability</h3><p>The date, time and duration selected on the left are used for slot blocking.</p>
                    <label>Reason (required)<input required value={adminForm.reason} onChange={(e) => setAdminForm({ ...adminForm, reason: e.target.value })} /></label>
                    <div className="admin-actions"><button className="outline" disabled={busy || !adminForm.reason.trim()} onClick={() => adminBlock(false)}>Block selected slot</button><button className="outline" disabled={busy || !adminForm.reason.trim() || adminForm.date <= today()} onClick={() => adminBlock(true)}>Block entire day</button></div>
                    <h3>Active blocks</h3><div className="admin-list">{!adminData.blocks.length ? <p>No blocked periods.</p> : adminData.blocks.map((b) => <article key={b.id}><span><strong>{new Date(b.start_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}</strong> – {new Date(b.end_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}<br />Reason: {b.reason}</span><button className="plain" onClick={() => removeBlock(b.id)}>Remove</button></article>)}</div>
                  </div>
                </div>
                <section className="admin-scanner">
                  <h3>Scan booking QR</h3>
                  <p>Scan the customer's booking QR or enter its reference to view the confirmed booking.</p>
                  <div className="admin-actions">
                    <button className="outline" type="button" onClick={() => setScanning((value) => !value)}><Camera size={17} /> {scanning ? "Stop camera" : "Open scanner"}</button>
                  </div>
                  {scanning && <div id="admin-qr-reader" className="qr-reader" />}
                  <form className="scan-reference" onSubmit={(event) => { event.preventDefault(); findScannedBooking(scanReference); }}>
                    <label>Booking reference<input required placeholder="SBL-CRT-YYYYMMDD-000000" value={scanReference} onChange={(event) => setScanReference(event.target.value.toUpperCase())} /></label>
                    <button className="green">Find booking</button>
                  </form>
                  {scannedBooking && <article className="scanned-booking">
                    <div><QrCode size={28} /><strong>Verified booking</strong></div>
                    <h3>{scannedBooking.reference}</h3>
                    <p><b>{scannedBooking.customer_name}</b> · {scannedBooking.mobile}</p>
                    <p>{scannedBooking.booking_date} · {String(scannedBooking.start_time).slice(0, 5)} IST · {scannedBooking.duration_minutes} minutes</p>
                    <span>{scannedBooking.status} · {scannedBooking.payment_method} · Paid ₹{((scannedBooking.amount_paid_paise || 0) / 100).toLocaleString("en-IN")}</span>
                  </article>}
                </section>
                <h3>All bookings</h3><div className="booking-list admin-bookings">{!adminData.bookings.length ? <p>No bookings yet.</p> : adminData.bookings.map((b) => <article key={b.id}><b>{b.reference || "Payment pending"} · {b.customer_name}</b><p>{b.booking_date} · {String(b.start_time).slice(0, 5)} IST · {b.duration_minutes} minutes · {b.mobile}</p><span>{b.status} · {b.payment_method} · Paid ₹{((b.amount_paid_paise || 0) / 100).toLocaleString("en-IN")}</span></article>)}</div>
                <button className="plain" onClick={async () => { await db.auth.signOut(); setAdminData(null); setAdminPassword(""); setMessage(""); }}>Sign out owner</button>
              </>
            )}
            {message && <p className="notice" role="status">{message}</p>}
          </section>
        </div>
      )}
      {modal && (
        <div
          className="modal-overlay"
          onClick={(e) => e.target === e.currentTarget && setModal(null)}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={modal}
          >
            <button
              className="close plain"
              aria-label="Close dialog"
              onClick={() => setModal(null)}
            >
              <X />
            </button>
            {modal === "login" ? (
              <>
                <span className="overline">WELCOME TO THE SQUAD</span>
                <h2>Your next innings awaits.</h2>
                <p>
                  {codeSent
                    ? `Enter the verification code sent to ${authMethod === "phone" ? `+91 ${phone}` : email}.`
                    : "Sign in securely with a verification code sent by email or SMS."}
                </p>
                {message && <p className="notice success" role="status"><Check size={17} /> {message}</p>}
                <form onSubmit={login}>
                  {!codeSent && (
                    <>
                      <label>
                        Your name
                        <input
                          required
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          autoComplete="name"
                        />
                      </label>
                      <label>
                        Mobile number
                        <input
                          required
                          pattern="[6-9][0-9]{9}"
                          title="Enter a 10-digit Indian mobile number"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          autoComplete="tel"
                        />
                      </label>
                      <label>
                        Send verification code by
                        <select value={authMethod} onChange={(e) => { setAuthMethod(e.target.value); setMessage(""); }}>
                          <option value="email">Email</option>
                          <option value="phone">SMS to mobile</option>
                        </select>
                      </label>
                      <label>
                        {authMethod === "phone" ? "Email for booking confirmations" : "Email address"}
                        <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                      </label>
                    </>
                  )}
                  {codeSent && (
                    <label>
                      Verification code
                      <input
                        required
                        inputMode="numeric"
                        pattern="[0-9]{6,8}"
                        value={code}
                        onChange={(e) =>
                          setCode(e.target.value.replace(/\D/g, "").slice(0, 8))
                        }
                        autoComplete="one-time-code"
                        autoFocus
                      />
                    </label>
                  )}
                  <button className="green" disabled={busy}>
                    {busy
                      ? codeSent
                        ? "Verifying…"
                        : "Sending…"
                      : codeSent
                        ? "Verify & sign in"
                        : "Send verification code"}
                    <ArrowRight size={17} />
                  </button>
                  {codeSent && (
                    <button
                      type="button"
                      className="plain"
                      onClick={() => {
                        setCode("");
                        setCodeSent(false);
                        setMessage("");
                      }}
                    >
                      Use different details
                    </button>
                  )}
                </form>
              </>
            ) : modal === "confirmation" ? (
              <>
                <span className="overline">BOOKING CONFIRMED</span>
                <h2>Your ground is ready.</h2>
                {message && <p className="notice success" role="status"><Check size={17} /> {message}</p>}
                {bookingConfirmation && <div className="booking-confirmation">
                  {bookingQr && <img src={bookingQr} alt={`Booking QR code for ${bookingConfirmation.reference}`} />}
                  <h3>{bookingConfirmation.reference}</h3>
                  <p><b>{bookingConfirmation.customer_name}</b></p>
                  <p>{bookingConfirmation.booking_date} · {String(bookingConfirmation.start_time).slice(0, 5)} IST · {bookingConfirmation.duration_minutes} minutes</p>
                  <p>Mobile: {bookingConfirmation.mobile}</p>
                  <strong>Paid ₹{((bookingConfirmation.amount_paise || 0) / 100).toLocaleString("en-IN")}</strong>
                  <small>Show this QR code at the turf. The owner can scan it to retrieve your booking.</small>
                </div>}
                <button className="green" onClick={() => { setModal(null); setMessage(""); }}>Done</button>
              </>
            ) : modal === "checkout" ? (
              <>
                <span className="overline">MAKE IT A GAME</span>
                <h2>Your innings, reserved next.</h2>
                <div className="checkout-summary">
                  <b>Nigam's Turf</b>
                  <p>
                    {date} · {time?.start_time} IST · {duration} minutes
                  </p>
                  <strong>₹{price.toLocaleString("en-IN")}</strong>
                  <small>
                    Final taxes and discounts are calculated securely at
                    checkout.
                  </small>
                </div>
                <form onSubmit={checkout}>
                  <label>
                    Full name
                    <input
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <label>
                    Mobile number
                    <input
                      required
                      pattern="[6-9][0-9]{9}"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      title="Enter a 10-digit Indian mobile number"
                    />
                  </label>
                  <label>
                    Coupon code (optional)
                    <input
                      value={coupon}
                      onChange={(e) => setCoupon(e.target.value.toUpperCase())}
                    />
                  </label>
                  <button className="green" disabled={busy}>
                    {busy ? "Reserving…" : "Continue to secure payment"}
                    <ShieldCheck size={17} />
                  </button>
                  <small>
                    A reservation lasts 10 minutes. Payment is confirmed by the
                    server.
                  </small>
                </form>
              </>
            ) : (
              <>
                <span className="overline">
                  {modal === "admin" ? "OWNER WORKSPACE" : "YOUR GAME PLAN"}
                </span>
                <h2>
                  {modal === "admin" ? "Bookings & revenue" : "My bookings"}
                </h2>
                {!session ? (
                  <>
                    <p>
                      Sign in to access your bookings. Owner access requires an
                      administrator role.
                    </p>
                    <button className="green" onClick={() => open("login")}>
                      Sign in <ArrowRight size={17} />
                    </button>
                  </>
                ) : (
                  <>
                    {modal === "admin" && (
                      <p>
                        Only authorized owners can view all bookings. Database
                        access policies protect customer data.
                      </p>
                    )}
                    <div className="booking-list">
                      {!bookings.length ? (
                        <p>No bookings to display.</p>
                      ) : (
                        bookings.map((b) => (
                          <article key={b.id}>
                            <b>{b.reference || "Payment pending"}</b>
                            <p>
                              {b.booking_date} · {b.start_time} IST ·{" "}
                              {b.duration_minutes} minutes
                            </p>
                            <span>
                              {b.status} · ₹
                              {(b.amount_paise / 100).toLocaleString("en-IN")}
                            </span>
                            {b.status === "confirmed" && (
                              <button
                                className="outline"
                                disabled={busy}
                                onClick={() => cancel(b)}
                              >
                                Request cancellation
                              </button>
                            )}
                          </article>
                        ))
                      )}
                    </div>
                    <button
                      className="plain"
                      onClick={async () => {
                        await db.auth.signOut();
                        setModal(null);
                      }}
                    >
                      Sign out
                    </button>
                  </>
                )}
              </>
            )}
            {message && modal !== "login" && modal !== "confirmation" && (
              <p className="notice" role="status">
                {message}
              </p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);
