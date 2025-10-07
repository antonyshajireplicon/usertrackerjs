<?php
/*
Plugin Name: Navigation Tracker with OpenAI
Description: Tracks user navigation + time, then fetches GPT-4 recommendations.
Version: 1.0
Author: You
*/

// Enqueue our script
add_action('wp_enqueue_scripts', function() {
    wp_enqueue_script(
        'navigation-tracker',
        plugin_dir_url(__FILE__) . 'navigation-tracker.js',
        [],
        time(),
        true // load in footer
    );
});
