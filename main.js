// Initialize Lucide icons
lucide.createIcons();

// FAQ Toggle
window.toggleFaq = function(element) {
    const item = element.parentElement;
    const isActive = item.classList.contains('active');
    
    // Close all
    document.querySelectorAll('.faq-item').forEach(faq => {
        faq.classList.remove('active');
    });
    
    // Open clicked if it wasn't active
    if (!isActive) {
        item.classList.add('active');
    }
}

// Header scroll effect
window.addEventListener('scroll', () => {
    const header = document.getElementById('header');
    if (window.scrollY > 50) {
        header.style.boxShadow = '0 2px 20px rgba(0,0,0,0.05)';
    } else {
        header.style.boxShadow = 'none';
    }
});

console.log("Premium Website initialized successfully | Josué Berrú Negrete");
