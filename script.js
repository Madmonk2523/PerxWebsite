const navbar = document.getElementById("navbar");
const revealItems = document.querySelectorAll(".reveal");
const waitlistForm = document.getElementById("waitlistForm");
const feedback = document.getElementById("formFeedback");
const routePath = document.getElementById("routePath");
const userDot = document.getElementById("userDot");

window.addEventListener("scroll", () => {
  if (window.scrollY > 18) {
    navbar.classList.add("scrolled");
  } else {
    navbar.classList.remove("scrolled");
  }
});

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.2 }
);

revealItems.forEach((item) => observer.observe(item));

if (waitlistForm) {
  waitlistForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const emailInput = waitlistForm.querySelector("input[type='email']");
    const email = emailInput.value.trim();

    if (!email || !email.includes("@")) {
      feedback.textContent = "Enter a valid email to join early access.";
      return;
    }

    feedback.textContent = "You are in. PERX early access details are on the way.";
    waitlistForm.reset();
  });
}

function animateMapRoute() {
  if (!routePath || !userDot) {
    return;
  }

  const totalLength = routePath.getTotalLength();
  routePath.style.strokeDasharray = `${totalLength}`;
  routePath.style.strokeDashoffset = `${totalLength}`;

  const duration = 9000;
  let startTime = null;

  function frame(timestamp) {
    if (!startTime) {
      startTime = timestamp;
    }

    const elapsed = (timestamp - startTime) % duration;
    const progress = elapsed / duration;

    routePath.style.strokeDashoffset = `${totalLength * (1 - progress)}`;

    const point = routePath.getPointAtLength(totalLength * progress);
    userDot.style.left = `${point.x - 8}px`;
    userDot.style.top = `${point.y - 8}px`;

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

animateMapRoute();

const parallaxGroup = document.querySelector("[data-parallax-group]");
if (parallaxGroup) {
  const items = parallaxGroup.querySelectorAll("[data-parallax]");

  window.addEventListener("mousemove", (event) => {
    const x = (event.clientX / window.innerWidth - 0.5) * 2;
    const y = (event.clientY / window.innerHeight - 0.5) * 2;

    items.forEach((item) => {
      const depth = Number(item.dataset.parallax || 10);
      const moveX = x * depth;
      const moveY = y * depth;
      item.style.transform = `translate3d(${moveX}px, ${moveY}px, 0)`;
    });
  });
}
