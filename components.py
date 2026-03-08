import streamlit as st

def load_css(file_path):
    """Loads the CSS file into the Streamlit app."""
    with open(file_path) as f:
        st.markdown(f"<style>{f.read()}</style>", unsafe_allow_html=True)

def home_header():
    """Returns the large Komu logo for the home screen."""
    return '<div class="home-logo">Komu</div>'

def dock():
    """Returns the glass-morphic navigation dock."""
    return """
        <div class="dock">
            <div class="dock-icon" style="color: #6e48aa;">K</div>
            <div class="dock-icon">🌐</div>
            <div class="dock-icon">
                <img src="https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png" width="22">
            </div>
            <div class="dock-icon">💜</div>
        </div>
    """

def result_card(url, title, snippet):
    """Returns a single search result card formatted like the Google UI."""
    domain = url.split("//")[-1].split("/")[0]
    # Fetching a high-quality favicon
    fav = f"https://www.google.com/s2/favicons?sz=64&domain={domain}"
    
    return f"""
        <div class="res-card">
            <div class="res-url">
                <img src="{fav}" width="16" style="margin-right: 8px;"> 
                <span>{url[:80]}</span>
            </div>
            <a href="{url}" class="res-title" target="_blank">{title}</a>
            <div class="res-snippet">{snippet[:280]}</div>
        </div>
    """