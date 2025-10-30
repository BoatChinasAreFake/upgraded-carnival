/**
 * Casa del Sol - Restaurant Website JavaScript
 * Vanilla JavaScript for interactive features
 * No frameworks used
 */

(function() {
    'use strict';

    // ===================================
    // Mobile Navigation Toggle
    // ===================================
    
    function initMobileNav() {
        const navToggle = document.querySelector('.nav-toggle');
        const navMenu = document.querySelector('.nav-menu');
        const navLinks = document.querySelectorAll('.nav-menu a');
        
        if (!navToggle || !navMenu) return;
        
        // Toggle menu
        navToggle.addEventListener('click', function() {
            const isExpanded = navToggle.getAttribute('aria-expanded') === 'true';
            navToggle.setAttribute('aria-expanded', !isExpanded);
            navMenu.classList.toggle('active');
        });
        
        // Close menu when clicking a link
        navLinks.forEach(function(link) {
            link.addEventListener('click', function() {
                navToggle.setAttribute('aria-expanded', 'false');
                navMenu.classList.remove('active');
            });
        });
        
        // Close menu when clicking outside
        document.addEventListener('click', function(event) {
            const isClickInsideNav = navMenu.contains(event.target) || navToggle.contains(event.target);
            if (!isClickInsideNav && navMenu.classList.contains('active')) {
                navToggle.setAttribute('aria-expanded', 'false');
                navMenu.classList.remove('active');
            }
        });
        
        // Close menu on Escape key
        document.addEventListener('keydown', function(event) {
            if (event.key === 'Escape' && navMenu.classList.contains('active')) {
                navToggle.setAttribute('aria-expanded', 'false');
                navMenu.classList.remove('active');
                navToggle.focus();
            }
        });
    }

    // ===================================
    // Smooth Scrolling for Anchor Links
    // ===================================
    
    function initSmoothScroll() {
        const links = document.querySelectorAll('a[href^="#"]');
        
        links.forEach(function(link) {
            link.addEventListener('click', function(e) {
                const href = this.getAttribute('href');
                
                // Don't prevent default if it's just "#" (no target)
                if (href === '#') return;
                
                const target = document.querySelector(href);
                if (target) {
                    e.preventDefault();
                    
                    // Get header height for offset
                    const header = document.querySelector('header');
                    const headerHeight = header ? header.offsetHeight : 0;
                    
                    const targetPosition = target.offsetTop - headerHeight;
                    
                    window.scrollTo({
                        top: targetPosition,
                        behavior: 'smooth'
                    });
                    
                    // Set focus to target for accessibility
                    target.setAttribute('tabindex', '-1');
                    target.focus();
                }
            });
        });
    }

    // ===================================
    // Menu Filtering
    // ===================================
    
    function initMenuFilter() {
        const filterButtons = document.querySelectorAll('.filter-btn');
        const menuItems = document.querySelectorAll('.menu-item');
        
        if (filterButtons.length === 0 || menuItems.length === 0) return;
        
        filterButtons.forEach(function(button) {
            button.addEventListener('click', function() {
                const filter = this.getAttribute('data-filter');
                
                // Update active state
                filterButtons.forEach(function(btn) {
                    btn.classList.remove('active');
                    btn.setAttribute('aria-selected', 'false');
                });
                this.classList.add('active');
                this.setAttribute('aria-selected', 'true');
                
                // Filter menu items
                menuItems.forEach(function(item) {
                    const category = item.getAttribute('data-category');
                    
                    if (filter === 'all' || category === filter) {
                        item.classList.remove('hidden');
                        item.style.display = 'block';
                    } else {
                        item.classList.add('hidden');
                        item.style.display = 'none';
                    }
                });
            });
        });
    }

    // ===================================
    // Gallery Interaction
    // ===================================
    
    function initGallery() {
        const galleryItems = document.querySelectorAll('.gallery-item');
        
        galleryItems.forEach(function(item) {
            // Handle click
            item.addEventListener('click', function() {
                const label = this.querySelector('.gallery-label').textContent;
                // In a real implementation, this would open a lightbox/modal with proper ARIA attributes
                // For now, we'll log to console as a placeholder
                console.log('Gallery item clicked:', label);
                // Visual feedback
                this.style.opacity = '0.7';
                setTimeout(function() {
                    item.style.opacity = '1';
                }, 200);
            });
            
            // Handle keyboard (Enter or Space)
            item.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.click();
                }
            });
        });
    }

    // ===================================
    // Form Validation and Submission
    // ===================================
    
    function initFormValidation() {
        const form = document.querySelector('.contact-form');
        if (!form) return;
        
        // Validation patterns
        const patterns = {
            name: /^[a-zA-Z\s]{2,50}$/,
            email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
            phone: /^[\d\s\-\(\)]{10,}$/
        };
        
        // Validation messages
        const messages = {
            name: 'Please enter a valid name (2-50 characters, letters only)',
            email: 'Please enter a valid email address',
            phone: 'Please enter a valid phone number',
            date: 'Please select a date',
            time: 'Please select a time',
            guests: 'Please select number of guests'
        };
        
        // Real-time validation
        function validateField(field) {
            const fieldName = field.name;
            const fieldValue = field.value.trim();
            const errorElement = field.parentElement.querySelector('.error-message');
            
            let isValid = true;
            let errorMessage = '';
            
            // Check if required field is empty
            if (field.hasAttribute('required') && !fieldValue) {
                isValid = false;
                errorMessage = messages[fieldName] || 'This field is required';
            }
            // Check pattern for specific fields
            else if (fieldValue && patterns[fieldName]) {
                if (!patterns[fieldName].test(fieldValue)) {
                    isValid = false;
                    errorMessage = messages[fieldName];
                }
            }
            
            // Update UI
            if (!isValid) {
                field.classList.add('error');
                if (errorElement) {
                    errorElement.textContent = errorMessage;
                }
            } else {
                field.classList.remove('error');
                if (errorElement) {
                    errorElement.textContent = '';
                }
            }
            
            return isValid;
        }
        
        // Add blur event listeners for real-time validation
        const formFields = form.querySelectorAll('input[required], select[required]');
        formFields.forEach(function(field) {
            field.addEventListener('blur', function() {
                validateField(this);
            });
            
            // Clear error on input
            field.addEventListener('input', function() {
                if (this.classList.contains('error')) {
                    this.classList.remove('error');
                    const errorElement = this.parentElement.querySelector('.error-message');
                    if (errorElement) {
                        errorElement.textContent = '';
                    }
                }
            });
        });
        
        // Form submission
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            
            let isFormValid = true;
            
            // Validate all required fields
            formFields.forEach(function(field) {
                if (!validateField(field)) {
                    isFormValid = false;
                }
            });
            
            if (isFormValid) {
                // Get form data
                const formData = new FormData(form);
                const data = {};
                formData.forEach(function(value, key) {
                    data[key] = value;
                });
                
                // In a real application, this would send data to a server
                console.log('Form submitted with data:', data);
                
                // Show success message
                const successMessage = form.querySelector('.form-success');
                if (successMessage) {
                    successMessage.textContent = 'Thank you! Your reservation request has been received. We will contact you shortly to confirm.';
                    successMessage.classList.add('show');
                    
                    // Reset form
                    form.reset();
                    
                    // Hide success message after 5 seconds
                    setTimeout(function() {
                        successMessage.classList.remove('show');
                    }, 5000);
                    
                    // Scroll to success message
                    successMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            } else {
                // Focus on first error field
                const firstError = form.querySelector('.error');
                if (firstError) {
                    firstError.focus();
                }
            }
        });
    }

    // ===================================
    // Active Navigation Highlighting
    // ===================================
    
    function initActiveNav() {
        const sections = document.querySelectorAll('section[id]');
        const navLinks = document.querySelectorAll('.nav-menu a[href^="#"]');
        
        if (sections.length === 0 || navLinks.length === 0) return;
        
        function highlightNav() {
            let currentSection = '';
            
            sections.forEach(function(section) {
                const sectionTop = section.offsetTop;
                const sectionHeight = section.offsetHeight;
                const header = document.querySelector('header');
                const headerHeight = header ? header.offsetHeight : 0;
                
                if (window.pageYOffset >= sectionTop - headerHeight - 100) {
                    currentSection = section.getAttribute('id');
                }
            });
            
            navLinks.forEach(function(link) {
                link.classList.remove('active');
                const href = link.getAttribute('href');
                if (href === '#' + currentSection) {
                    link.classList.add('active');
                }
            });
        }
        
        // Throttle scroll event for performance
        let scrollTimeout;
        window.addEventListener('scroll', function() {
            if (scrollTimeout) {
                window.cancelAnimationFrame(scrollTimeout);
            }
            scrollTimeout = window.requestAnimationFrame(highlightNav);
        });
        
        // Initial call
        highlightNav();
    }

    // ===================================
    // Set minimum date for reservation form
    // ===================================
    
    function initDateRestrictions() {
        const dateInput = document.querySelector('#date');
        if (!dateInput) return;
        
        // Set minimum date to today
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const minDate = year + '-' + month + '-' + day;
        
        dateInput.setAttribute('min', minDate);
        
        // Set maximum date to 3 months from now
        const maxDate = new Date();
        maxDate.setMonth(maxDate.getMonth() + 3);
        const maxYear = maxDate.getFullYear();
        const maxMonth = String(maxDate.getMonth() + 1).padStart(2, '0');
        const maxDay = String(maxDate.getDate()).padStart(2, '0');
        const maxDateString = maxYear + '-' + maxMonth + '-' + maxDay;
        
        dateInput.setAttribute('max', maxDateString);
    }

    // ===================================
    // Initialize all features when DOM is ready
    // ===================================
    
    function init() {
        initMobileNav();
        initSmoothScroll();
        initMenuFilter();
        initGallery();
        initFormValidation();
        initActiveNav();
        initDateRestrictions();
    }
    
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
