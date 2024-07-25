"use strict";
$(function() {
    function a() {
        $(".faqCont .faqQuestion").removeClass("active"),
        $(".faqCont .faqAnswer").slideUp(300)
    }
    $(window).on("scroll", function() {
        100 < $(window).scrollTop() ? $("header").addClass("scrolling") : $("header").removeClass("scrolling")
    }),
    $(window).on("scroll", function() {
        200 < $(window).scrollTop() ? $(".mediaIcons").fadeIn(300) : $(".mediaIcons").fadeOut(300)
    }),
    $(window).on("scroll", function() {
        600 < $(window).scrollTop() ? $(".goTop").fadeIn(300) : $(".goTop").fadeOut(300)
    }),
    $(".goTop").on("click", function() {
        $("body, html").animate({
            scrollTop: 0
        }, 400)
    }),
    $(".faqQuestion").on("click", function(o) {
        var t = $(this).attr("href");
        $(o.target).is(".active") ? a() : (a(),
        $(this).addClass("active"),
        $(".faqCont " + t).slideDown(300)),
        o.preventDefault()
    })
});
